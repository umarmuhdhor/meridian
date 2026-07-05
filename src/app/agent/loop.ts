import type { AppContext } from "../tools/context.js";
import type { ChatMessage, LLMClient, ToolCallRequest, ToolChoice } from "../../ports/llm-client.js";
import type { ToolRegistry } from "../tools/registry.js";
import { executeTool, formatToolError, type ToolError } from "../tools/execute.js";
import { generateOpenAiToolSchemas } from "../tools/generate-openai-schemas.js";
import { createSessionLocks, type SessionLocks } from "./session-locks.js";

export type AgentRole = "SCREENER" | "MANAGER" | "GENERAL";

export interface AgentLoopOptions {
  role: AgentRole;
  goal: string;
  systemPrompt: string;
  model: string;
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;
  /** Persisted conversation to prepend after the system prompt. */
  history?: ChatMessage[];
  /** Override role→tools subset. If omitted, entire registry is exposed. */
  toolFilter?: readonly string[];
  /** Force tool_choice=required on step 0. Useful for action intents. */
  requireToolOnFirstStep?: boolean;
  onToolStart?: (name: string, args: unknown) => Promise<void> | void;
  onToolFinish?: (name: string, ok: boolean, summary?: string) => Promise<void> | void;
}

export interface AgentLoopDeps {
  llm: LLMClient;
  registry: ToolRegistry;
  ctx: AppContext;
}

export interface AgentToolTrace {
  step: number;
  name: string;
  args: unknown;
  ok: boolean;
  result?: unknown;
  error?: ToolError;
}

export interface AgentLoopResult {
  text: string;
  steps: number;
  toolCalls: AgentToolTrace[];
  finishReason: "stop" | "max_steps" | "no_final_text" | "no_tool_after_reminder";
  locks: readonly string[];
  messages: ChatMessage[];
}

const DEFAULT_MAX_STEPS = 20;
const NO_TOOL_REMINDER =
  "You must call a tool to complete this task — text-only replies are not acceptable for action intents. Call the appropriate tool.";

/**
 * ReAct loop v1 — LLM → (tool_calls | final text) → executeTool → repeat.
 * No provider fallback / no system-role fallback / no tool_choice retry yet
 * (those live in a future revision — this v1 assumes a well-behaved OpenAI-compat
 * provider so the shape stays legible). Session locks + no-tool retry ARE enforced.
 */
export async function runAgentLoop(
  deps: AgentLoopDeps,
  opts: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const activeRegistry = opts.toolFilter
    ? deps.registry
    : deps.registry;
  const activeTools = opts.toolFilter
    ? deps.registry.subset(opts.toolFilter)
    : deps.registry.all();
  const openAiTools = generateOpenAiToolSchemas({
    // small local registry for the schemas-emit only path
    all: () => activeTools,
    subset: () => [],
    get: (name: string) => activeTools.find((t) => t.name === name),
    has: (name: string) => activeTools.some((t) => t.name === name),
    names: () => activeTools.map((t) => t.name),
  } as unknown as ToolRegistry);
  const locks: SessionLocks = createSessionLocks();
  const trace: AgentToolTrace[] = [];

  const messages: ChatMessage[] = [
    { role: "system", content: opts.systemPrompt },
    ...(opts.history ?? []),
    { role: "user", content: opts.goal },
  ];

  let noToolRetries = 0;
  let reminderPending = false;

  for (let step = 0; step < maxSteps; step += 1) {
    const toolChoice: ToolChoice = opts.requireToolOnFirstStep && step === 0 ? "required" : "auto";

    const response = await deps.llm.chat({
      model: opts.model,
      messages,
      tools: openAiTools,
      tool_choice: toolChoice,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
    });

    // No tool calls → assistant text. Either terminate or nudge if a tool was required.
    if (response.tool_calls.length === 0) {
      const text = response.text?.trim() ?? "";
      if (reminderPending) {
        // Already reminded once — accept text-only reply as failure to comply.
        messages.push({ role: "assistant", content: text });
        return {
          text,
          steps: step + 1,
          toolCalls: trace,
          finishReason: "no_tool_after_reminder",
          locks: locks.locked(),
          messages,
        };
      }
      if (opts.requireToolOnFirstStep && step === 0 && text.length > 0) {
        noToolRetries += 1;
        reminderPending = true;
        messages.push({ role: "assistant", content: text });
        messages.push({ role: "user", content: NO_TOOL_REMINDER });
        continue;
      }
      messages.push({ role: "assistant", content: text });
      return {
        text,
        steps: step + 1,
        toolCalls: trace,
        finishReason: text.length === 0 ? "no_final_text" : "stop",
        locks: locks.locked(),
        messages,
      };
    }
    // Any tool call clears the reminder state — the LLM is complying.
    reminderPending = false;

    // Assistant message that invoked tools — record verbatim so history stays API-valid.
    messages.push({
      role: "assistant",
      content: response.text ?? "",
      tool_calls: response.tool_calls,
    });

    for (const call of response.tool_calls) {
      const outcome = await runOneToolCall(activeRegistry, call, deps.ctx, locks, opts);
      const t: AgentToolTrace = { step, name: call.name, args: outcome.args, ok: outcome.ok };
      if (outcome.ok) {
        t.result = outcome.result;
      } else if (outcome.error) {
        t.error = outcome.error;
      }
      trace.push(t);
      messages.push({
        role: "tool",
        content: outcome.messageContent,
        tool_call_id: call.id,
        name: call.name,
      });
    }
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  return {
    text: lastAssistant?.content ?? "",
    steps: maxSteps,
    toolCalls: trace,
    finishReason: "max_steps",
    locks: locks.locked(),
    messages,
  };
}

interface ToolRunOutcome {
  args: unknown;
  ok: boolean;
  result?: unknown;
  error?: ToolError;
  messageContent: string;
}

async function runOneToolCall(
  registry: ToolRegistry,
  call: ToolCallRequest,
  ctx: AppContext,
  locks: SessionLocks,
  opts: AgentLoopOptions,
): Promise<ToolRunOutcome> {
  const gate = locks.checkBefore(call.name);
  if (gate.blocked) {
    const err = { kind: "safety_blocked" as const, name: call.name, reason: gate.reason ?? "session lock" };
    return {
      args: call.arguments,
      ok: false,
      error: err,
      messageContent: JSON.stringify({ error: formatToolError(err) }),
    };
  }

  await opts.onToolStart?.(call.name, safeParseArgs(call.arguments));

  const result = await executeTool(registry, { name: call.name, args: call.arguments }, ctx);
  const def = registry.get(call.name);
  locks.recordAfter(call.name, result.ok, def);

  await opts.onToolFinish?.(call.name, result.ok, result.ok ? undefined : formatToolError(result.error));

  if (result.ok) {
    return {
      args: safeParseArgs(call.arguments),
      ok: true,
      result: result.value,
      messageContent: JSON.stringify(result.value),
    };
  }
  return {
    args: safeParseArgs(call.arguments),
    ok: false,
    error: result.error,
    messageContent: JSON.stringify({ error: formatToolError(result.error) }),
  };
}

function safeParseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
