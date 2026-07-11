import type { LiveMessageHandle, Notifier } from "../../ports/notifier.js";

const nullLive: LiveMessageHandle = {
  toolStart: async () => {},
  toolFinish: async () => {},
  note: async () => {},
  finalize: async () => {},
  fail: async () => {},
};

/** No-op — for DRY_RUN, tests, and boot before Telegram is configured. */
export const nullNotifier: Notifier = {
  notify: async () => {},
  notifyDeploy: async () => {},
  notifyClose: async () => {},
  notifyClaim: async () => {},
  notifySwap: async () => {},
  notifyOutOfRange: async () => {},
  startLive: async () => nullLive,
};
