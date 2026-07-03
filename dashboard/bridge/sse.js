// dashboard/bridge/sse.js
// Shared SSE broadcaster for GET /events. ONE cache-read interval, many subscribers
// (§8.7, M4). Piggybacks the daemon's existing PnL poller: getMyPositions({force:false})
// returns the cache the poller already warms every ~3s, so this adds NO new RPC call
// (#8). Kept entirely in the bridge — the daemon core (index.js) is NOT touched.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getMyPositions } from "../../tools/dlmm.js";
import { getStateSummary } from "../../state.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const subs = new Set();
let timer = null;
let lastDecisionCount = -1;

function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of subs) {
    try {
      res.write(frame);
    } catch {
      subs.delete(res); // dead socket
    }
  }
}

async function poll() {
  if (subs.size === 0) return;
  // Only read positions when the daemon is actually tracking some. The PnL poller
  // skips fetching with 0 positions (index.js:729), so the cache is cold then and a
  // force:false read would trigger a fresh RPC. Gating on state.json (sync, no RPC)
  // keeps the "no new RPC" guarantee airtight (#8): with >=1 position the poller
  // warms the cache every ~3s, so this force:false read is always a cache hit. The
  // M1 10s polling fallback still covers the transition back to 0 positions.
  let hasPositions = false;
  try {
    hasPositions = (getStateSummary()?.open_positions ?? 0) > 0;
  } catch {
    /* state unreadable → treat as none, stay conservative */
  }
  if (hasPositions) {
    try {
      const positions = await getMyPositions({ force: false, silent: true });
      if (positions) broadcast("pnl_tick", positions);
    } catch {
      /* transient — clients keep their last value / polling fallback */
    }
  }
  // Nudge clients to refetch the decision log when it grows (small capped file).
  try {
    const dl = JSON.parse(await readFile(path.join(ROOT, "decision-log.json"), "utf8"));
    const count = Array.isArray(dl?.decisions) ? dl.decisions.length : 0;
    if (lastDecisionCount >= 0 && count !== lastDecisionCount) broadcast("decision", { count });
    lastDecisionCount = count;
  } catch {
    /* file may not exist yet */
  }
}

export function sseSubscribe(res) {
  subs.add(res);
  if (!timer) timer = setInterval(poll, 3000);
  poll(); // immediate first tick
}

export function sseUnsubscribe(res) {
  subs.delete(res);
  if (subs.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
    lastDecisionCount = -1;
  }
}
