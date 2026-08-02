/**
 * Plain-English formatters for decision-log entries.
 *
 * The Decisions page is read by humans (mostly the owner, sometimes teammates
 * over the shoulder). Terse machine strings ("base_mint_already_in_use (3)")
 * force the reader to translate. These helpers spell things out so a screenshot
 * of the page is self-explanatory.
 *
 * Rules for what belongs here:
 *   - Pure. No I/O, no ctx. Takes primitives, returns strings.
 *   - Deterministic. Same input = same output; safe for snapshot tests.
 *   - No emojis. The dashboard renders card headers separately.
 */

// ── bin-range ↔ % price ──────────────────────────────────────────────────────

/**
 * Meteora DLMM bin pricing: each bin's price is `(1 + bin_step/10000)^n`.
 * So the total price range across N bins is `(1+bs/10000)^N - 1`.
 *
 * Returns null when bin_step is unknown — callers should skip the "%" note in
 * that case rather than print a bogus "0%".
 */
export function binRangeToPricePct(
  binStep: number | null | undefined,
  lowerBin: number,
  upperBin: number,
): number | null {
  if (binStep == null || !Number.isFinite(binStep) || binStep <= 0) return null;
  const span = upperBin - lowerBin;
  if (span < 0) return null;
  const r = 1 + binStep / 10000;
  return (Math.pow(r, span) - 1) * 100;
}

/**
 * Where does the active bin sit inside [lower, upper]? Returned as a human phrase
 * so downstream text reads naturally ("price is at the top edge of the range").
 */
export function activeBinPosition(
  active: number,
  lower: number,
  upper: number,
): "at the top edge" | "near the top" | "in the middle" | "near the bottom" | "at the bottom edge" | "above range" | "below range" {
  if (active > upper) return "above range";
  if (active < lower) return "below range";
  const span = upper - lower;
  if (span === 0) return "in the middle";
  const rel = (active - lower) / span;
  if (rel >= 0.95) return "at the top edge";
  if (rel >= 0.65) return "near the top";
  if (rel >= 0.35) return "in the middle";
  if (rel >= 0.05) return "near the bottom";
  return "at the bottom edge";
}

// ── strategy explanations ─────────────────────────────────────────────────────

/**
 * One-line human gloss for a DLMM strategy shape. Used verbatim in decision text.
 */
export function explainStrategy(strategy: string): string {
  switch (strategy) {
    case "bid_ask":
      return "bid-ask (liquidity at range edges, best for volatile / trending tokens)";
    case "curve":
      return "curve (liquidity concentrated at active bin, best for stable pairs)";
    case "spot":
      return "spot (liquidity spread evenly across the range, balanced)";
    default:
      return strategy;
  }
}

// ── deploy summary + reason ───────────────────────────────────────────────────

export interface DeploySummaryInput {
  pool_name: string | null | undefined;
  pool_address: string;
  amount_sol: number;
  strategy: string;
  lower_bin: number;
  upper_bin: number;
  active_bin: number;
  bin_step?: number | null | undefined;
}

/** Short one-liner shown as card title. */
export function formatDeploySummary(d: DeploySummaryInput): string {
  const name = d.pool_name ?? `${d.pool_address.slice(0, 6)}…`;
  return `Opened ${name} position — ${d.amount_sol} SOL, ${d.strategy.replace("_", "-")} strategy`;
}

/** Paragraph shown as card body (`reason` field). Auto-fits under 500 chars. */
export function formatDeployReason(d: DeploySummaryInput): string {
  const bins = d.upper_bin - d.lower_bin;
  const pct = binRangeToPricePct(d.bin_step, d.lower_bin, d.upper_bin);
  const rangeNote =
    pct != null
      ? `${bins}-bin range ≈ ±${pct.toFixed(1)}% of current price`
      : `${bins}-bin range (bin step unknown)`;
  const posNote = `Price sits ${activeBinPosition(d.active_bin, d.lower_bin, d.upper_bin)}.`;
  return [
    `Strategy: ${explainStrategy(d.strategy)}.`,
    `Range: bins ${d.lower_bin} → ${d.upper_bin} (${rangeNote}).`,
    posNote,
    "Earn fees while price stays in range; auto-exit rules watch stop-loss, take-profit, and range drift.",
  ].join(" ");
}

// ── close summary + reason ────────────────────────────────────────────────────

export interface CloseSummaryInput {
  pool_name?: string | null | undefined;
  position_address: string;
  final_pnl_pct: number | null;
  final_value_usd: number | null;
  fees_earned_usd: number;
  reason: string; // raw exit reason (e.g. "stop loss", "take profit")
}

export function formatCloseSummary(c: CloseSummaryInput): string {
  const name = c.pool_name ?? `${c.position_address.slice(0, 6)}…`;
  const pnl = c.final_pnl_pct == null ? "?" : `${c.final_pnl_pct >= 0 ? "+" : ""}${c.final_pnl_pct.toFixed(2)}%`;
  return `Closed ${name} — PnL ${pnl} (${c.reason})`;
}

export function formatCloseReason(c: CloseSummaryInput): string {
  const parts: string[] = [];
  parts.push(`Exit trigger: ${explainCloseReason(c.reason)}.`);
  if (c.final_pnl_pct != null) {
    parts.push(`Final PnL ${c.final_pnl_pct >= 0 ? "+" : ""}${c.final_pnl_pct.toFixed(2)}%.`);
  }
  if (c.final_value_usd != null) {
    parts.push(`Value at close: $${c.final_value_usd.toFixed(2)}.`);
  }
  if (c.fees_earned_usd > 0) {
    parts.push(`Fees earned this position: $${c.fees_earned_usd.toFixed(2)}.`);
  }
  return parts.join(" ");
}

/** Turn a short exit-rule reason into a human sentence fragment. */
export function explainCloseReason(reason: string): string {
  const r = reason.toLowerCase();
  // Trailing must be checked BEFORE "take profit" — "trailing take profit" would
  // otherwise match the plain take-profit branch first and lose the trailing nuance.
  if (r.includes("trailing")) return "trailing take-profit (price dropped from its peak after locking in gains)";
  if (r.includes("stop loss")) return "stop-loss (loss hit the configured cap)";
  if (r.includes("take profit")) return "take-profit (gain reached the configured target)";
  if (r.includes("pumped above range")) return "price pumped above the range (position is 100% base token, no more fees to earn)";
  if (r.includes("out_of_range") || r.includes("oor")) return "price left the range and stayed out too long (no fees while OOR)";
  if (r.includes("low yield")) return "yield too low for too long (fee/TVL below floor, position is dead weight)";
  return reason;
}

// ── skip / no-deploy explanations ────────────────────────────────────────────

export function formatInsufficientSolReason(walletSol: number, need: number, deployAmount: number, gasReserve: number): string {
  const shortage = need - walletSol;
  return [
    `Wallet has ${walletSol.toFixed(4)} SOL; need ${need.toFixed(4)} SOL to open a position`,
    `(${deployAmount} deploy + ${gasReserve} gas reserve).`,
    shortage > 0 ? `Short ${shortage.toFixed(4)} SOL — fund the wallet to resume screening.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function formatMaxPositionsReason(current: number, max: number): string {
  return [
    `At the ${max}-position cap (${current} open).`,
    "Meridian will not open a new position until an existing one closes",
    "(stop-loss / take-profit / OOR-timeout / manual /close).",
  ].join(" ");
}

/**
 * Compose the no-eligible-candidates card body. `details` is the per-token
 * rejection list from get_top_candidates (already formatted human-readable).
 */
export function formatNoCandidatesReason(scanned: number, rejected: number, details: readonly string[]): string {
  const shown = details.slice(0, 5);
  const more = details.length > shown.length ? ` (+${details.length - shown.length} more)` : "";
  const list = shown.length ? `\n  • ${shown.join("\n  • ")}${more}` : "";
  return `Scanned ${scanned} pools, ${rejected} filtered out, 0 passed hard filters.${list}`;
}
