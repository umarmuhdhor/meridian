"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PositionsResponse } from "./types";

// SSE live updates (M4). When connected, positions are updated by push
// (qc.setQueryData) and decision-log is invalidated on new entries. This is an
// OPTIMIZATION layered on top of the M1 polling — if SSE fails (bridge down,
// proxy error), we close the stream and the existing refetchInterval keeps the UI
// live. No token is used here; the browser talks only to the same-origin proxy.
export function useLiveEvents(enabled = true) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/events");
      es.addEventListener("pnl_tick", (e) => {
        try {
          qc.setQueryData<PositionsResponse>(["positions"], JSON.parse((e as MessageEvent).data));
        } catch {
          /* ignore malformed frame */
        }
      });
      es.addEventListener("decision", () => {
        qc.invalidateQueries({ queryKey: ["decision-log"] });
      });
      es.addEventListener("error", () => {
        // Stop auto-reconnect storms; polling fallback stays active for the session.
        es?.close();
      });
    } catch {
      /* EventSource unsupported / blocked → polling fallback */
    }
    return () => es?.close();
  }, [enabled, qc]);
}
