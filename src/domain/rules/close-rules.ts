import type { ManagementConfig } from "../schemas/config.js";
import type { LivePositionSnapshot, TrackedPosition } from "../schemas/position.js";

export type CloseRuleId = 1 | 2 | 3 | 4 | 5;

export interface CloseDecision {
  action: "CLOSE";
  rule: CloseRuleId;
  reason: "stop loss" | "take profit" | "pumped far above range" | "OOR" | "low yield";
}

export interface PnlSuspectContext {
  tracked?: Pick<TrackedPosition, "amount_sol"> | null;
}

const MIN_TOTAL_VALUE_USD_FOR_SUSPECT = 0.01;
const PNL_PCT_SUSPECT_FLOOR = -90;
const MIN_LOW_YIELD_AGE_MINUTES = 60;

export function isPnlSuspect(
  position: Pick<LivePositionSnapshot, "pnl_pct" | "pnl_pct_suspicious" | "total_value_usd">,
  ctx: PnlSuspectContext = {},
): boolean {
  if (position.pnl_pct_suspicious) return true;
  if (position.pnl_pct == null) return false;
  if (position.pnl_pct > PNL_PCT_SUSPECT_FLOOR) return false;
  const trackedAmount = ctx.tracked?.amount_sol;
  const totalValueUsd = position.total_value_usd ?? 0;
  if (trackedAmount != null && trackedAmount > 0 && totalValueUsd > MIN_TOTAL_VALUE_USD_FOR_SUSPECT) {
    return true;
  }
  return false;
}

/**
 * Deterministic close decision — the 5 hard rules mirroring index.js:900.
 * Pure over `position` + `managementConfig` + `ctx`. Returns null when position should stay open.
 */
export function getDeterministicCloseRule(
  position: LivePositionSnapshot,
  managementConfig: ManagementConfig,
  ctx: PnlSuspectContext = {},
): CloseDecision | null {
  const pnlSuspect = isPnlSuspect(position, ctx);

  if (
    !pnlSuspect &&
    position.pnl_pct != null &&
    position.pnl_pct <= managementConfig.stopLossPct
  ) {
    return { action: "CLOSE", rule: 1, reason: "stop loss" };
  }

  if (
    !pnlSuspect &&
    position.pnl_pct != null &&
    position.pnl_pct >= managementConfig.takeProfitPct
  ) {
    return { action: "CLOSE", rule: 2, reason: "take profit" };
  }

  if (
    position.active_bin != null &&
    position.upper_bin != null &&
    position.active_bin > position.upper_bin + managementConfig.outOfRangeBinsToClose
  ) {
    return { action: "CLOSE", rule: 3, reason: "pumped far above range" };
  }

  if (
    position.active_bin != null &&
    position.upper_bin != null &&
    position.active_bin > position.upper_bin &&
    (position.minutes_out_of_range ?? 0) >= managementConfig.outOfRangeWaitMinutes
  ) {
    return { action: "CLOSE", rule: 4, reason: "OOR" };
  }

  if (
    position.fee_per_tvl_24h != null &&
    position.fee_per_tvl_24h < managementConfig.minFeePerTvl24h &&
    (position.age_minutes ?? 0) >= MIN_LOW_YIELD_AGE_MINUTES
  ) {
    return { action: "CLOSE", rule: 5, reason: "low yield" };
  }

  return null;
}
