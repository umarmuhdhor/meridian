import type { AnyToolDef } from "../tools/types.js";

export interface SessionLockOutcome {
  /** True when the tool is currently blocked from firing. */
  blocked: boolean;
  reason?: string;
}

/**
 * Prevents an LLM from calling the same destructive tool twice within one agent run.
 *
 *  - `oncePerSession` tools (deploy_position, close_position, swap_token) lock after a
 *    *successful* call — a genuine failure can be retried.
 *  - `noRetry` tools (deploy_position) lock after the FIRST attempt regardless of outcome —
 *    retrying a partial on-chain write can double-spend.
 *
 * Kept as a pure state machine so the agent loop can call `checkBefore` before firing and
 * `recordAfter` after — no shared mutable module state.
 */
export interface SessionLocks {
  checkBefore(toolName: string): SessionLockOutcome;
  recordAfter(toolName: string, success: boolean, def: AnyToolDef | undefined): void;
  /** Currently locked tool names — for logging / diagnostics. */
  locked(): readonly string[];
}

export function createSessionLocks(): SessionLocks {
  const locked = new Set<string>();

  return {
    checkBefore(toolName) {
      if (locked.has(toolName)) {
        return { blocked: true, reason: `tool ${toolName} already fired this session` };
      }
      return { blocked: false };
    },
    recordAfter(toolName, success, def) {
      if (!def) return;
      if (def.noRetry) {
        // Locks unconditionally after first attempt.
        locked.add(toolName);
        return;
      }
      if (def.oncePerSession && success) {
        locked.add(toolName);
      }
    },
    locked() {
      return Array.from(locked);
    },
  };
}
