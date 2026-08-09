import { describe, expect, it } from "vitest";
import {
  computeCandidateHistory,
  computePortfolioAggregate,
  formatCandidateHistoryLine,
  formatPortfolioAggregate,
} from "../../src/domain/format/candidate-history.js";
import type { PerformanceRecord } from "../../src/domain/schemas/lesson.js";

const NOW = new Date("2026-08-09T08:00:00Z");

function rec(over: Partial<PerformanceRecord>): PerformanceRecord {
  return {
    position: "pos1",
    pool: "poolA",
    pool_name: "TOK-SOL",
    pnl_pct: -10,
    close_reason: "stop_loss",
    recorded_at: NOW.toISOString(),
    closed_at: NOW.toISOString(),
    ...over,
  } as PerformanceRecord;
}

describe("computeCandidateHistory", () => {
  it("returns zeros when performance is empty", () => {
    const h = computeCandidateHistory({ pool_address: "poolA", base_mint: "mintA" }, [], NOW);
    expect(h.pool_count).toBe(0);
    expect(h.base_mint_count).toBe(0);
    expect(h.pool_avg_pnl_pct).toBeNull();
    expect(h.base_mint_avg_pnl_pct).toBeNull();
    expect(formatCandidateHistoryLine(h)).toBeNull();
  });

  it("aggregates by pool + by base_mint independently", () => {
    const perf: PerformanceRecord[] = [
      rec({ pool: "poolA", base_mint: "mintX", pnl_pct: -20 }),
      rec({ pool: "poolB", base_mint: "mintX", pnl_pct: -10 }), // same token, different pool
      rec({ pool: "poolC", base_mint: "mintY", pnl_pct: 30 }),
    ];
    const h = computeCandidateHistory({ pool_address: "poolA", base_mint: "mintX" }, perf, NOW);
    expect(h.pool_count).toBe(1);
    expect(h.pool_avg_pnl_pct).toBe(-20);
    expect(h.base_mint_count).toBe(2);
    expect(h.base_mint_avg_pnl_pct).toBe(-15);
    const line = formatCandidateHistoryLine(h);
    expect(line).toContain("same pool 1");
    expect(line).toContain("same base_mint 2");
  });

  it("picks newest base_mint close for last_pnl + last_ago_min", () => {
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60_000).toISOString();
    const threeHoursAgo = new Date(NOW.getTime() - 3 * 60 * 60_000).toISOString();
    const perf: PerformanceRecord[] = [
      rec({ pool: "poolX", base_mint: "mintZ", pnl_pct: -22, closed_at: threeHoursAgo }),
      rec({ pool: "poolY", base_mint: "mintZ", pnl_pct: -18, closed_at: oneHourAgo }),
    ];
    const h = computeCandidateHistory({ pool_address: "poolNew", base_mint: "mintZ" }, perf, NOW);
    expect(h.base_mint_last_pnl_pct).toBe(-18);
    expect(h.base_mint_last_ago_min).toBe(60);
  });

  it("skips base_mint match when candidate has no base_mint", () => {
    const perf: PerformanceRecord[] = [rec({ pool: "poolA", base_mint: "mintX" })];
    const h = computeCandidateHistory({ pool_address: "poolB", base_mint: null }, perf, NOW);
    expect(h.base_mint_count).toBe(0);
  });
});

describe("computePortfolioAggregate", () => {
  it("returns n=0 empty rows on empty input", () => {
    const a = computePortfolioAggregate([], { limit: 30 });
    expect(a.n).toBe(0);
    expect(a.by_strategy).toEqual([]);
    expect(formatPortfolioAggregate(a)).toBe("PRIOR EXPERIENCE: no closed positions yet.");
  });

  it("buckets by strategy / volatility / mcap, counts wins vs losses", () => {
    const perf: PerformanceRecord[] = [
      rec({ strategy: "spot", volatility: 4, entry_mcap: 100_000, pnl_pct: 10 }),
      rec({ strategy: "spot", volatility: 6, entry_mcap: 30_000, pnl_pct: -20 }),
      rec({ strategy: "bid_ask", volatility: 6, entry_mcap: 40_000, pnl_pct: -25 }),
    ];
    const a = computePortfolioAggregate(perf, { limit: 30 });
    expect(a.n).toBe(3);
    const spot = a.by_strategy.find((r) => r.key === "spot");
    expect(spot).toEqual({ key: "spot", wins: 1, losses: 1, avg_pnl_pct: -5 });
    const bidAsk = a.by_strategy.find((r) => r.key === "bid_ask");
    expect(bidAsk?.losses).toBe(1);
    expect(bidAsk?.wins).toBe(0);
    const lt50k = a.by_mcap.find((r) => r.key === "<50k");
    expect(lt50k?.losses).toBe(2);
    const rendered = formatPortfolioAggregate(a);
    expect(rendered).toContain("PRIOR EXPERIENCE (last 3 closes):");
    expect(rendered).toContain("by strategy");
    expect(rendered).toContain("by volatility");
  });

  it("respects the limit — only the tail is considered", () => {
    const perf: PerformanceRecord[] = Array.from({ length: 50 }, (_, i) =>
      rec({ strategy: i < 40 ? "spot" : "curve", pnl_pct: 1 }),
    );
    const a = computePortfolioAggregate(perf, { limit: 10 });
    expect(a.n).toBe(10);
    expect(a.by_strategy.map((r) => r.key)).toEqual(["curve"]);
  });
});
