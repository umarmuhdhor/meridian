import type { ClaimResult, CloseResult, DeployResult, SwapResult } from "../../domain/schemas/chain.js";
import type { LiveMessageHandle, Notifier, NotifyKind } from "../../ports/notifier.js";

export type Recorded =
  | { type: "notify"; kind: NotifyKind; text: string }
  | { type: "deploy"; result: DeployResult }
  | { type: "close"; result: CloseResult }
  | { type: "claim"; result: ClaimResult }
  | { type: "swap"; result: SwapResult }
  | { type: "oor"; position: string; minutes: number }
  | { type: "live_start"; header: string }
  | { type: "live_tool_start"; name: string; args?: Record<string, unknown> }
  | { type: "live_tool_finish"; name: string; ok: boolean; summary?: string }
  | { type: "live_note"; text: string }
  | { type: "live_finalize"; text?: string }
  | { type: "live_fail"; reason: string };

export interface CollectingNotifier extends Notifier {
  readonly recorded: readonly Recorded[];
  clear(): void;
}

/** Test double — records every call in order. */
export function createCollectingNotifier(): CollectingNotifier {
  const recorded: Recorded[] = [];
  const push = (r: Recorded) => {
    recorded.push(r);
  };
  const notifier: CollectingNotifier = {
    recorded,
    clear: () => {
      recorded.length = 0;
    },
    notify: async (kind, text) => push({ type: "notify", kind, text }),
    notifyDeploy: async (result) => push({ type: "deploy", result }),
    notifyClose: async (result) => push({ type: "close", result }),
    notifyClaim: async (result) => push({ type: "claim", result }),
    notifySwap: async (result) => push({ type: "swap", result }),
    notifyOutOfRange: async (position, minutes) => push({ type: "oor", position, minutes }),
    startLive: async (header) => {
      push({ type: "live_start", header });
      const live: LiveMessageHandle = {
        toolStart: async (name, args) => push({ type: "live_tool_start", name, ...(args ? { args } : {}) }),
        toolFinish: async (name, ok, summary) =>
          push({ type: "live_tool_finish", name, ok, ...(summary ? { summary } : {}) }),
        note: async (text) => push({ type: "live_note", text }),
        finalize: async (text) => push({ type: "live_finalize", ...(text ? { text } : {}) }),
        fail: async (reason) => push({ type: "live_fail", reason }),
      };
      return live;
    },
  };
  return notifier;
}
