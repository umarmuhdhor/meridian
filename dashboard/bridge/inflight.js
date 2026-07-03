// dashboard/bridge/inflight.js
// Per-tool in-flight lock. Patches fact F3: the ONCE_PER_SESSION / NO_RETRY_TOOLS
// locks live in agent.js and do NOT apply to the bridge path (PRD §8.6, MUST #13).

const busy = new Map();

export const isBusy = (name) => busy.has(name);
export const acquire = (name) => (busy.has(name) ? false : (busy.set(name, true), true));
export const release = (name) => { busy.delete(name); };
