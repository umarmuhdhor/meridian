import type { z } from "zod";
import type { AppContext } from "./context.js";

/**
 * A safety check returns null when the call is allowed, or a block reason when it isn't.
 * Runs BEFORE `execute`. Return `null` = pass, `{ reason }` = deny.
 */
export type SafetyCheck<TArgs> = (
  args: TArgs,
  ctx: AppContext,
) => Promise<SafetyResult> | SafetyResult;

export type SafetyResult = null | { reason: string };

/**
 * Side-effect run after a successful tool call — notifier fanout, decision-log append,
 * pool-memory annotation, auto-swap, etc. Failure inside a hook does NOT fail the tool:
 * the hook logs and the loop continues (mirrors the current JS behavior where notify
 * failures never abort a deploy).
 */
export type PostHook<TArgs, TResult> = (
  args: TArgs,
  result: TResult,
  ctx: AppContext,
) => Promise<void> | void;

/**
 * The one shape every tool takes. Zod schemas double as OpenAI JSON Schema source and
 * as runtime validators — no drift possible between the LLM contract and the impl.
 */
export interface ToolDef<
  TArgsSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TResultSchema extends z.ZodTypeAny = z.ZodTypeAny,
> {
  name: string;
  description: string;
  args: TArgsSchema;
  result: TResultSchema;
  safety?: readonly SafetyCheck<z.output<TArgsSchema>>[];
  /** Side-effect hooks fired after successful validation. Errors are swallowed + logged. */
  post?: readonly PostHook<z.output<TArgsSchema>, z.output<TResultSchema>>[];
  execute: (
    args: z.output<TArgsSchema>,
    ctx: AppContext,
  ) => Promise<z.input<TResultSchema>> | z.input<TResultSchema>;
  /** Tools that must not be called twice in one agent session (deploy/close/swap). */
  oncePerSession?: boolean;
  /** Tools whose first attempt locks even on failure (deploy_position). */
  noRetry?: boolean;
}

export type AnyToolDef = ToolDef<z.ZodTypeAny, z.ZodTypeAny>;
