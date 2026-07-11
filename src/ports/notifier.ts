import type { ClaimResult, CloseResult, DeployResult, SwapResult } from "../domain/schemas/chain.js";

/**
 * A live message is edited in place — used to stream tool progress to Telegram inside
 * one message rather than firing a new one per tool call.
 */
export interface LiveMessageHandle {
  /** Called at the start of every tool. Adds a line with a spinner icon. */
  toolStart(name: string, args?: Record<string, unknown>): Promise<void>;
  /** Called at the end of every tool. Replaces the line's icon with ✅ or ❌. */
  toolFinish(name: string, ok: boolean, summary?: string): Promise<void>;
  /** Free-form note appended without a tool line. */
  note(text: string): Promise<void>;
  /** Terminal state — no more edits. */
  finalize(text?: string): Promise<void>;
  /** Terminal state with an error. */
  fail(reason: string): Promise<void>;
}

export interface Notifier {
  /** Send a standalone message. No-op when silenced. */
  notify(kind: NotifyKind, text: string): Promise<void>;

  notifyDeploy(result: DeployResult): Promise<void>;
  notifyClose(result: CloseResult): Promise<void>;
  notifyClaim(result: ClaimResult): Promise<void>;
  notifySwap(result: SwapResult): Promise<void>;
  notifyOutOfRange(positionAddress: string, minutes: number): Promise<void>;

  /** Start a live message. Callers must call finalize/fail. */
  startLive(header: string): Promise<LiveMessageHandle>;
}

export type NotifyKind = "info" | "warn" | "error" | "success";
