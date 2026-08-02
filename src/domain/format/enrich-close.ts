import type { CloseResult, OnChainPosition } from "../schemas/chain.js";

/**
 * Real on-chain close returns null pnl/value/fees — those roll up from
 * enrichment layers. Merge the pre-close snapshot data so notify/log
 * consumers see actual pnl %, fees, value, pair, and age instead of `?%`
 * and `$0`. Snapshot-less callers (e.g. unknown position) pass undefined
 * and the raw result flows through unchanged.
 */
export function enrichCloseResult(
  result: CloseResult,
  snapshot: OnChainPosition | undefined,
  peakPnlPct?: number | null,
): CloseResult {
  if (!snapshot) return result;
  return {
    ...result,
    base_mint: result.base_mint ?? snapshot.base_mint,
    final_pnl_pct: result.final_pnl_pct ?? snapshot.pnl_pct,
    final_value_usd: result.final_value_usd ?? snapshot.total_value_usd ?? null,
    fees_earned_usd: result.fees_earned_usd || snapshot.unclaimed_fees_usd || 0,
    pair: snapshot.pair,
    amount_sol_initial: snapshot.amount_sol ?? null,
    age_minutes: snapshot.age_minutes ?? null,
    peak_pnl_pct: peakPnlPct ?? null,
  };
}
