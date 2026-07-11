import { jsonrepair } from "jsonrepair";
import type { z } from "zod";
import { err, ok, type Result } from "../../shared/result.js";
import type { AppContext } from "./context.js";
import type { ToolRegistry } from "./registry.js";
import type { AnyToolDef } from "./types.js";

export type ToolError =
  | { kind: "unknown_tool"; name: string }
  | { kind: "args_parse_failed"; name: string; message: string }
  | { kind: "args_invalid"; name: string; issues: z.ZodIssue[] }
  | { kind: "safety_blocked"; name: string; reason: string }
  | { kind: "execute_failed"; name: string; message: string }
  | { kind: "result_invalid"; name: string; issues: z.ZodIssue[] };

export interface ToolInvocation {
  name: string;
  /** Args as either a JSON string (from LLM tool_call) or a decoded object. */
  args: string | Record<string, unknown>;
}

export interface ExecuteOptions {
  /** Attempt jsonrepair when raw args is a malformed JSON string. Default true. */
  attemptJsonRepair?: boolean;
}

/**
 * The one path every tool takes:
 *   parse args → Zod validate args → run safety chain → execute → Zod validate result.
 * Every failure branch is a discriminated error, not a thrown exception.
 */
export async function executeTool(
  registry: ToolRegistry,
  invocation: ToolInvocation,
  ctx: AppContext,
  opts: ExecuteOptions = {},
): Promise<Result<unknown, ToolError>> {
  const tool = registry.get(invocation.name);
  if (!tool) return err({ kind: "unknown_tool", name: invocation.name });

  const parsedArgs = parseArgs(tool, invocation.args, opts.attemptJsonRepair ?? true);
  if (!parsedArgs.ok) return parsedArgs;

  const argsValidated = tool.args.safeParse(parsedArgs.value);
  if (!argsValidated.success) {
    return err({ kind: "args_invalid", name: tool.name, issues: argsValidated.error.issues });
  }
  const args: unknown = argsValidated.data;

  for (const check of tool.safety ?? []) {
    const outcome = await check(args, ctx);
    if (outcome) {
      return err({ kind: "safety_blocked", name: tool.name, reason: outcome.reason });
    }
  }

  let raw: unknown;
  try {
    raw = await tool.execute(args, ctx);
  } catch (e) {
    return err({ kind: "execute_failed", name: tool.name, message: (e as Error).message });
  }

  const resultValidated = tool.result.safeParse(raw);
  if (!resultValidated.success) {
    return err({ kind: "result_invalid", name: tool.name, issues: resultValidated.error.issues });
  }

  const validated: unknown = resultValidated.data;
  for (const hook of tool.post ?? []) {
    try {
      await hook(args, validated, ctx);
    } catch (e) {
      ctx.logger.warn("tool_post_hook", `${tool.name} post-hook failed: ${(e as Error).message}`);
    }
  }
  return ok(validated);
}

function parseArgs(
  tool: AnyToolDef,
  raw: string | Record<string, unknown>,
  attemptRepair: boolean,
): Result<unknown, ToolError> {
  if (typeof raw !== "string") return ok(raw);
  const source = raw.trim();
  if (source.length === 0) return ok({});
  try {
    return ok(JSON.parse(source));
  } catch (first) {
    if (!attemptRepair) {
      return err({ kind: "args_parse_failed", name: tool.name, message: (first as Error).message });
    }
    try {
      return ok(JSON.parse(jsonrepair(source)));
    } catch (second) {
      return err({ kind: "args_parse_failed", name: tool.name, message: (second as Error).message });
    }
  }
}

export function formatToolError(e: ToolError): string {
  switch (e.kind) {
    case "unknown_tool":
      return `Unknown tool: ${e.name}`;
    case "args_parse_failed":
      return `${e.name}: args JSON invalid — ${e.message}`;
    case "args_invalid": {
      const first = e.issues[0];
      const label = first ? `${first.path.join(".") || "<root>"}: ${first.message}` : "unknown";
      return `${e.name}: args validation failed (${label})`;
    }
    case "safety_blocked":
      return `${e.name}: blocked — ${e.reason}`;
    case "execute_failed":
      return `${e.name}: execute threw — ${e.message}`;
    case "result_invalid": {
      const first = e.issues[0];
      const label = first ? `${first.path.join(".") || "<root>"}: ${first.message}` : "unknown";
      return `${e.name}: internal — result validation failed (${label})`;
    }
  }
}
