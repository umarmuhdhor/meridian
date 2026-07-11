// Per-tool in-flight lock. Patches the fact that the ONCE_PER_SESSION / NO_RETRY_TOOLS
// session locks live in the agent loop and do NOT apply to the bridge /tool path
// (PRD §8.6, MUST #13). Ported from dashboard/bridge/inflight.js.

const busy = new Map<string, true>();

export const isBusy = (name: string): boolean => busy.has(name);
export const acquire = (name: string): boolean =>
  busy.has(name) ? false : (busy.set(name, true), true);
export const release = (name: string): void => {
  busy.delete(name);
};
