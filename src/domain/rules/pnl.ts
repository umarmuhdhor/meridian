export interface PnlAssessment {
  /** Best-effort PnL % — prefers reported, falls back to derived. */
  pnl_pct: number | null;
  /** True when NEITHER value is priceable this tick. Gates PnL rules. */
  pnl_pct_suspicious: boolean;
  /** Absolute divergence between reported and derived, if both present. */
  divergence_pct: number | null;
  /** True when divergence exceeds the sanity threshold — informational, does not gate. */
  divergent: boolean;
}

/**
 * Pure — reconcile reported vs derived PnL %. Mirrors tools/dlmm.js:1219–1242.
 * - `suspicious` fires only when the tick is genuinely unpriceable (both null).
 * - Reported-vs-derived drift is logged elsewhere but does NOT freeze exits (prior bug fix).
 */
export function assessPnl(
  reportedPct: number | null | undefined,
  derivedPct: number | null | undefined,
  maxDiffPct: number,
): PnlAssessment {
  const reported = numberOrNull(reportedPct);
  const derived = numberOrNull(derivedPct);
  const suspicious = reported == null && derived == null;
  const pnl_pct = reported ?? derived ?? null;
  const divergence_pct =
    reported != null && derived != null ? Math.abs(reported - derived) : null;
  const divergent = divergence_pct != null && divergence_pct > maxDiffPct;
  return {
    pnl_pct,
    pnl_pct_suspicious: suspicious,
    divergence_pct,
    divergent,
  };
}

function numberOrNull(v: number | null | undefined): number | null {
  if (v == null) return null;
  if (!Number.isFinite(v)) return null;
  return v;
}

/**
 * Pure — round `value` to `decimals` places using half-away-from-zero (matches JS toFixed).
 */
export function roundNum(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
