// Shared SSE broadcaster for GET /events. ONE cache-read interval, many subscribers
// (§8.7, M4). Piggybacks the daemon's PnL poller: getMyPositions({force:false}) returns
// the cache the poller warms, so this adds NO new RPC (#8). Ported from
// dashboard/bridge/sse.js — the module singleton becomes a per-bridge factory bound to
// the injected chain client + position repo + state dir.

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ServerResponse } from "node:http";
import type { ChainClient } from "../../ports/chain-client.js";
import type { PositionRepo } from "../../ports/position-repo.js";

export interface SseHubDeps {
  chain: ChainClient;
  positions: PositionRepo;
  stateDir: string;
}

export interface SseHub {
  subscribe: (res: ServerResponse) => void;
  unsubscribe: (res: ServerResponse) => void;
}

export function createSseHub(deps: SseHubDeps): SseHub {
  const subs = new Set<ServerResponse>();
  let timer: NodeJS.Timeout | null = null;
  let lastDecisionCount = -1;

  const broadcast = (event: string, data: unknown): void => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of subs) {
      try {
        res.write(frame);
      } catch {
        subs.delete(res); // dead socket
      }
    }
  };

  const poll = async (): Promise<void> => {
    if (subs.size === 0) return;
    // Only read positions when the daemon is actually tracking some — mirrors the JS
    // gate on state.json so the "no new RPC" guarantee holds (#8): with >=1 position the
    // poller warms the cache, so this force:false read is a cache hit. Reading the repo
    // (JSON file, no RPC) keeps the gate cheap.
    let hasPositions = false;
    try {
      const open = await deps.positions.all(true);
      hasPositions = open.length > 0;
    } catch {
      /* state unreadable → treat as none, stay conservative */
    }
    if (hasPositions) {
      try {
        const positions = await deps.chain.getMyPositions({ force: false });
        if (positions) broadcast("pnl_tick", positions);
      } catch {
        /* transient — clients keep their last value / polling fallback */
      }
    }
    // Nudge clients to refetch the decision log when it grows (small capped file).
    try {
      const raw = await readFile(path.join(deps.stateDir, "decision-log.json"), "utf8");
      const dl = JSON.parse(raw) as { decisions?: unknown[] };
      const count = Array.isArray(dl?.decisions) ? dl.decisions.length : 0;
      if (lastDecisionCount >= 0 && count !== lastDecisionCount) broadcast("decision", { count });
      lastDecisionCount = count;
    } catch {
      /* file may not exist yet */
    }
  };

  return {
    subscribe(res: ServerResponse): void {
      subs.add(res);
      if (!timer) timer = setInterval(() => void poll(), 3000);
      void poll(); // immediate first tick
    },
    unsubscribe(res: ServerResponse): void {
      subs.delete(res);
      if (subs.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
        lastDecisionCount = -1;
      }
    },
  };
}
