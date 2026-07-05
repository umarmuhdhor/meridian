import type { ChatRequest, ChatResponse, LLMClient, ToolCallRequest } from "../../ports/llm-client.js";

/**
 * A scripted response — the fake LLM returns these in order, one per chat() call.
 * If the script runs out, the client throws.
 */
export type FakeStep =
  | { kind: "assistant"; text: string; finishReason?: string }
  | { kind: "tool_calls"; calls: Array<{ name: string; args: Record<string, unknown> | string }> };

export interface FakeLLMOptions {
  script: FakeStep[];
  model?: string;
}

export interface FakeLLMClient extends LLMClient {
  /** How many chat() calls happened. */
  callCount(): number;
  /** Every request the loop sent. Useful for asserting message history. */
  requests(): ChatRequest[];
  /** Replace the remaining script (from current index onward). */
  extend(steps: FakeStep[]): void;
}

/**
 * Scripted LLM — plays back the given `script` one step per chat() call. Every response
 * carries auto-generated tool_call ids. Records every request for assertion.
 */
export function createFakeLLM(opts: FakeLLMOptions): FakeLLMClient {
  const script: FakeStep[] = [...opts.script];
  const requests: ChatRequest[] = [];
  const model = opts.model ?? "fake/model-v1";
  let idCounter = 0;
  let cursor = 0;

  return {
    callCount: () => cursor,
    requests: () => requests.map((r) => structuredClone(r)),
    extend(steps) {
      script.push(...steps);
    },
    async chat(req: ChatRequest): Promise<ChatResponse> {
      requests.push(req);
      const step = script[cursor];
      cursor += 1;
      if (!step) {
        throw new Error(
          `FakeLLM script exhausted after ${cursor - 1} calls — extend script or check loop termination.`,
        );
      }
      if (step.kind === "assistant") {
        return {
          text: step.text,
          tool_calls: [],
          finish_reason: step.finishReason ?? "stop",
          model,
        };
      }
      const calls: ToolCallRequest[] = step.calls.map((c) => ({
        id: `fake-call-${++idCounter}`,
        name: c.name,
        arguments: typeof c.args === "string" ? c.args : JSON.stringify(c.args),
      }));
      return {
        text: null,
        tool_calls: calls,
        finish_reason: "tool_calls",
        model,
      };
    },
  };
}
