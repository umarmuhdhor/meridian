import type { ManagementConfig } from "../schemas/config.js";
import type { LivePositionSnapshot, TrackedPosition } from "../schemas/position.js";
import { isPnlSuspect } from "./close-rules.js";

export type ExitAction = "STOP_LOSS" | "TRAILING_TP" | "OUT_OF_RANGE" | "LOW_YIELD";

export interface ExitSignal {
  action: ExitAction;
  reason: string;
  needs_confirmation?: boolean;
  peak_pnl_pct?: number;
  current_pnl_pct?: number;
  drop_from_peak_pct?: number;
}

/**
 * Pure state-diff derived from a live tick. Applied to the persisted position by the caller.
 */
export interface PositionUpdates {
  trailing_active?: boolean;
  out_of_range_since?: string | null;
}

export interface DetectExitContext {
  now: Date;
}

/**
 * Given the current persisted position + a live snapshot + config, compute:
 *   - what mutations to apply (trailing_active flip, OOR timestamp set/clear)
 *   - whether an exit signal fires
 *
 * Pure: no I/O, no clock — caller injects `now` via ctx.
 */
export function evaluateExit(
  pos: TrackedPosition,
  data: LivePositionSnapshot,
  mgmt: ManagementConfig,
  ctx: DetectExitContext,
): { updates: PositionUpdates; signal: ExitSignal | null } {
  if (pos.closed) return { updates: {}, signal: null };

  const updates: PositionUpdates = {};

  // Activate trailing TP once trigger threshold is reached
  const peak = pos.peak_pnl_pct ?? 0;
  if (mgmt.trailingTakeProfit && !pos.trailing_active && peak >= mgmt.trailingTriggerPct) {
    updates.trailing_active = true;
  }
  const trailingActive = updates.trailing_active ?? pos.trailing_active;

  // Update OOR state
  const nowIso = ctx.now.toISOString();
  let effectiveOorSince: string | null = pos.out_of_range_since;
  if (data.in_range === false && !pos.out_of_range_since) {
    updates.out_of_range_since = nowIso;
    effectiveOorSince = nowIso;
  } else if (data.in_range === true && pos.out_of_range_since) {
    updates.out_of_range_since = null;
    effectiveOorSince = null;
  }

  const suspect = isPnlSuspect(data, { tracked: pos });
  const currentPnl = data.pnl_pct;

  // ── Stop loss ─────────────────────────────────
  if (!suspect && currentPnl != null && currentPnl <= mgmt.stopLossPct) {
    return {
      updates,
      signal: {
        action: "STOP_LOSS",
        reason: `Stop loss: PnL ${currentPnl.toFixed(2)}% <= ${mgmt.stopLossPct}%`,
      },
    };
  }

  // ── Trailing TP ───────────────────────────────
  if (!suspect && trailingActive && currentPnl != null) {
    const dropFromPeak = peak - currentPnl;
    if (dropFromPeak >= mgmt.trailingDropPct) {
      return {
        updates,
        signal: {
          action: "TRAILING_TP",
          reason: `Trailing TP: peak ${peak.toFixed(2)}% → current ${currentPnl.toFixed(2)}% (dropped ${dropFromPeak.toFixed(2)}% >= ${mgmt.trailingDropPct}%)`,
          needs_confirmation: true,
          peak_pnl_pct: peak,
          current_pnl_pct: currentPnl,
          drop_from_peak_pct: dropFromPeak,
        },
      };
    }
  }

  // ── Out of range too long ─────────────────────
  if (effectiveOorSince) {
    const minutesOOR = Math.floor((ctx.now.getTime() - new Date(effectiveOorSince).getTime()) / 60_000);
    if (minutesOOR >= mgmt.outOfRangeWaitMinutes) {
      return {
        updates,
        signal: {
          action: "OUT_OF_RANGE",
          reason: `Out of range for ${minutesOOR}m (limit: ${mgmt.outOfRangeWaitMinutes}m)`,
        },
      };
    }
  }

  // ── Low yield ─────────────────────────────────
  const minAge = mgmt.minAgeBeforeYieldCheck;
  if (
    data.fee_per_tvl_24h != null &&
    data.fee_per_tvl_24h < mgmt.minFeePerTvl24h &&
    (data.age_minutes == null || data.age_minutes >= minAge)
  ) {
    return {
      updates,
      signal: {
        action: "LOW_YIELD",
        reason: `Low yield: fee/TVL ${data.fee_per_tvl_24h.toFixed(2)}% < min ${mgmt.minFeePerTvl24h}% (age: ${data.age_minutes ?? "?"}m)`,
      },
    };
  }

  return { updates, signal: null };
}
