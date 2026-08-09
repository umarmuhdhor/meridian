import type { PerformanceRecord } from "../schemas/lesson.js";

/**
 * Pure — turns closed-trade history (lessons.performance) into inline context
 * for the screening decider. Two shapes:
 *
 *   - per-candidate: prior deploys on the same pool AND on the same base_mint
 *     (base_mint match catches "different pool, same token" — a common Sage
 *     misfire where the same losing meme coin got re-deployed in an alternative
 *     pool a few hours later).
 *   - portfolio aggregate: rolling window bucketed by strategy / volatility /
 *     entry_mcap. Not a rule — just "here is how each shape performed lately"
 *     so the decider can reason about drift.
 */

export interface CandidateHistoryLine {
  pool_count: number;
  pool_avg_pnl_pct: number | null;
  base_mint_count: number;
  base_mint_avg_pnl_pct: number | null;
  base_mint_last_pnl_pct: number | null;
  base_mint_last_ago_min: number | null;
}

export function computeCandidateHistory(
  candidate: { pool_address: string; base_mint?: string | null | undefined },
  performance: readonly PerformanceRecord[],
  now: Date,
): CandidateHistoryLine {
  const poolMatches = performance.filter((p) => p.pool === candidate.pool_address);
  const mint = candidate.base_mint ?? null;
  const mintMatches = mint
    ? performance.filter((p) => (p as { base_mint?: string | null }).base_mint === mint)
    : [];

  const avg = (arr: readonly PerformanceRecord[]): number | null =>
    arr.length ? arr.reduce((s, r) => s + r.pnl_pct, 0) / arr.length : null;

  let lastPnl: number | null = null;
  let lastAgoMin: number | null = null;
  if (mintMatches.length) {
    const sorted = [...mintMatches].sort((a, b) => {
      const at = Date.parse(a.closed_at ?? a.recorded_at);
      const bt = Date.parse(b.closed_at ?? b.recorded_at);
      return bt - at;
    });
    const newest = sorted[0];
    if (newest) {
      lastPnl = newest.pnl_pct;
      const t = Date.parse(newest.closed_at ?? newest.recorded_at);
      if (Number.isFinite(t)) {
        lastAgoMin = Math.max(0, Math.round((now.getTime() - t) / 60_000));
      }
    }
  }

  return {
    pool_count: poolMatches.length,
    pool_avg_pnl_pct: avg(poolMatches),
    base_mint_count: mintMatches.length,
    base_mint_avg_pnl_pct: avg(mintMatches),
    base_mint_last_pnl_pct: lastPnl,
    base_mint_last_ago_min: lastAgoMin,
  };
}

function formatAgo(minutes: number): string {
  if (minutes < 60) return `${minutes}m ago`;
  const h = minutes / 60;
  if (h < 24) return `${h.toFixed(1)}h ago`;
  return `${(h / 24).toFixed(1)}d ago`;
}

/** Returns null when there is nothing to say (no prior pool or mint history). */
export function formatCandidateHistoryLine(h: CandidateHistoryLine): string | null {
  const parts: string[] = [];
  if (h.pool_count > 0) {
    parts.push(
      `same pool ${h.pool_count} prior close${h.pool_count === 1 ? "" : "s"} avg=${(h.pool_avg_pnl_pct ?? 0).toFixed(1)}%`,
    );
  }
  if (h.base_mint_count > 0) {
    const ago = h.base_mint_last_ago_min == null ? "" : ` last=${formatAgo(h.base_mint_last_ago_min)}`;
    parts.push(
      `same base_mint ${h.base_mint_count} prior close${h.base_mint_count === 1 ? "" : "s"} avg=${(h.base_mint_avg_pnl_pct ?? 0).toFixed(1)}% last_pnl=${(h.base_mint_last_pnl_pct ?? 0).toFixed(1)}%${ago}`,
    );
  }
  return parts.length ? parts.join("  ") : null;
}

// ── portfolio aggregate ──

export interface AggregateRow {
  key: string;
  wins: number;
  losses: number;
  avg_pnl_pct: number;
}

export interface PortfolioAggregate {
  n: number;
  by_strategy: AggregateRow[];
  by_volatility: AggregateRow[];
  by_mcap: AggregateRow[];
}

function bucketVolatility(v: number): string {
  if (v < 3) return "<3";
  if (v <= 5) return "3-5";
  return ">5";
}

function bucketMcap(m: number): string {
  if (m < 50_000) return "<50k";
  if (m < 500_000) return "50k-500k";
  if (m < 5_000_000) return "500k-5M";
  return ">5M";
}

export function computePortfolioAggregate(
  performance: readonly PerformanceRecord[],
  opts: { limit?: number } = {},
): PortfolioAggregate {
  const slice = opts.limit ? performance.slice(-opts.limit) : performance;

  const group = (keyOf: (p: PerformanceRecord) => string | null): AggregateRow[] => {
    const buckets = new Map<string, { wins: number; losses: number; sum: number; count: number }>();
    for (const p of slice) {
      const k = keyOf(p);
      if (k == null) continue;
      const b = buckets.get(k) ?? { wins: 0, losses: 0, sum: 0, count: 0 };
      if (p.pnl_pct > 0) b.wins++;
      else b.losses++;
      b.sum += p.pnl_pct;
      b.count++;
      buckets.set(k, b);
    }
    return [...buckets.entries()]
      .map(([key, b]) => ({
        key,
        wins: b.wins,
        losses: b.losses,
        avg_pnl_pct: b.count ? b.sum / b.count : 0,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  };

  return {
    n: slice.length,
    by_strategy: group((p) => p.strategy ?? null),
    by_volatility: group((p) => (p.volatility != null ? bucketVolatility(p.volatility) : null)),
    by_mcap: group((p) => (p.entry_mcap != null ? bucketMcap(p.entry_mcap) : null)),
  };
}

export function formatPortfolioAggregate(a: PortfolioAggregate): string {
  if (a.n === 0) return "PRIOR EXPERIENCE: no closed positions yet.";
  const line = (label: string, rows: readonly AggregateRow[]): string | null => {
    if (!rows.length) return null;
    return (
      `  ${label}: ` +
      rows.map((r) => `${r.key} ${r.wins}W/${r.losses}L avg=${r.avg_pnl_pct.toFixed(1)}%`).join("   ")
    );
  };
  const lines: string[] = [`PRIOR EXPERIENCE (last ${a.n} closes):`];
  const ls = line("by strategy  ", a.by_strategy);
  const lv = line("by volatility", a.by_volatility);
  const lm = line("by mcap      ", a.by_mcap);
  if (ls) lines.push(ls);
  if (lv) lines.push(lv);
  if (lm) lines.push(lm);
  return lines.join("\n");
}
