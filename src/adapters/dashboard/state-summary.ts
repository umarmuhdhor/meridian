// TS equivalent of the JS `getStateSummary()` (state.js:323) that the dashboard bridge
// surfaced via GET /state/summary. Built from the position repo (state.json). Output
// keys are snake_case to match what the web's `StateSummary` type reads.

import type { PositionRepo } from "../../ports/position-repo.js";
import type { Clock } from "../../ports/clock.js";

export interface StateSummaryPosition {
  position: string;
  pool: string;
  strategy: string;
  deployed_at: string;
  out_of_range_since: string | null;
  minutes_out_of_range: number | null;
  total_fees_claimed_usd: number;
  initial_fee_tvl_24h: number | null;
  rebalance_count: number;
  instruction: string | null;
}

export interface StateSummary {
  open_positions: number;
  closed_positions: number;
  total_fees_claimed_usd: number;
  positions: StateSummaryPosition[];
  last_updated: string | null;
  recent_events: unknown[];
}

function minutesSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now.getTime() - then) / 60_000));
}

export async function buildStateSummary(
  positions: PositionRepo,
  clock: Clock,
): Promise<StateSummary | null> {
  const loaded = await positions.load();
  if (!loaded.ok) return null;
  const state = loaded.value;
  const all = Object.values(state.positions);
  const open = all.filter((p) => !p.closed);
  const closed = all.filter((p) => p.closed);
  const totalFeesClaimed = all.reduce((s, p) => s + (p.total_fees_claimed_usd || 0), 0);
  const now = clock.now();

  return {
    open_positions: open.length,
    closed_positions: closed.length,
    total_fees_claimed_usd: Math.round(totalFeesClaimed * 100) / 100,
    positions: open.map((p) => ({
      position: p.position,
      pool: p.pool,
      strategy: p.strategy,
      deployed_at: p.deployed_at,
      out_of_range_since: p.out_of_range_since,
      minutes_out_of_range: minutesSince(p.out_of_range_since, now),
      total_fees_claimed_usd: p.total_fees_claimed_usd,
      initial_fee_tvl_24h: p.initial_fee_tvl_24h ?? null,
      rebalance_count: p.rebalance_count,
      instruction: p.instruction ?? null,
    })),
    last_updated: state.lastUpdated,
    recent_events: (state.recentEvents ?? []).slice(-10),
  };
}
