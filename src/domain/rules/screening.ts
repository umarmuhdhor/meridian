import type { AppConfig } from "../schemas/config.js";
import type { CandidatePool } from "../schemas/market.js";
import { scoreCandidate } from "./scoring.js";

export interface ScreeningThresholds {
  minTvl: number;
  maxTvl: number;
  minVolume: number;
  minOrganic: number;
  minHolders: number;
  minMcap: number;
  maxMcap: number;
  minBinStep: number;
  maxBinStep: number;
  minFeeActiveTvlRatio: number;
  maxBotHoldersPct: number;
  maxTop10Pct: number;
  minTokenAgeHours: number | null;
  maxTokenAgeHours: number | null;
  allowedLaunchpads: readonly string[];
  blockedLaunchpads: readonly string[];
}

/**
 * Extract screening thresholds from AppConfig. Reads straight from `cfg.screening.*`
 * so the live user-config (and dashboard Config edits) actually drive the hard filter.
 * Previously this ignored `cfg` and returned inline constants — a config-drift footgun
 * that made every screening dial in the dashboard a no-op.
 */
export function defaultThresholds(cfg: AppConfig): ScreeningThresholds {
  const s = cfg.screening;
  return {
    minTvl: s.minTvl,
    maxTvl: s.maxTvl,
    minVolume: s.minVolume,
    minOrganic: s.minOrganic,
    minHolders: s.minHolders,
    minMcap: s.minMcap,
    maxMcap: s.maxMcap,
    minBinStep: s.minBinStep,
    maxBinStep: s.maxBinStep,
    minFeeActiveTvlRatio: s.minFeeActiveTvlRatio,
    maxBotHoldersPct: s.maxBotHoldersPct,
    maxTop10Pct: s.maxTop10Pct,
    minTokenAgeHours: s.minTokenAgeHours,
    maxTokenAgeHours: s.maxTokenAgeHours,
    allowedLaunchpads: s.allowedLaunchpads,
    blockedLaunchpads: s.blockedLaunchpads,
  };
}

export type RejectionReason =
  | { kind: "tvl_out_of_range"; value: number; min: number; max: number }
  | { kind: "volume_below_min"; value: number; min: number }
  | { kind: "organic_below_min"; value: number; min: number }
  | { kind: "holders_below_min"; value: number; min: number }
  | { kind: "mcap_out_of_range"; value: number; min: number; max: number }
  | { kind: "bin_step_out_of_range"; value: number; min: number; max: number }
  | { kind: "fee_tvl_below_min"; value: number; min: number }
  | { kind: "launchpad_blocked"; value: string }
  | { kind: "launchpad_not_allowed"; value: string; allowed: readonly string[] }
  | { kind: "token_age_out_of_range"; value: number; min: number | null; max: number | null }
  | { kind: "on_pool_cooldown" }
  | { kind: "on_base_mint_cooldown" }
  | { kind: "base_mint_blacklisted" }
  | { kind: "base_mint_already_in_use" }
  | { kind: "bot_holders_pct_too_high"; value: number; max: number }
  | { kind: "top10_pct_too_high"; value: number; max: number };

export interface FilterResult {
  passed: CandidatePool[];
  rejected: Array<{ pool: CandidatePool; reason: RejectionReason }>;
}

export interface FilterContext {
  /** Poolwise + base-mint cooldown checkers — pre-loaded so filter stays pure/sync-ish. */
  onPoolCooldown: (pool: CandidatePool) => boolean;
  onBaseMintCooldown: (pool: CandidatePool) => boolean;
  isBlacklisted: (mint: string) => boolean;
  /** Base mints currently in use by open positions — screener won't stack same mint. */
  baseMintsInUse: ReadonlySet<string>;
}

/**
 * Pure hard-filter over a candidate list. Each rejection carries a reason so the caller
 * can log a `no_deploy` decision with the top rejection causes. Order of checks mirrors
 * tools/screening.js hard filter phase.
 */
export function hardFilter(
  pools: readonly CandidatePool[],
  th: ScreeningThresholds,
  ctx: FilterContext,
): FilterResult {
  const passed: CandidatePool[] = [];
  const rejected: FilterResult["rejected"] = [];

  for (const pool of pools) {
    const reason = firstFailure(pool, th, ctx);
    if (reason) rejected.push({ pool, reason });
    else passed.push(pool);
  }

  return { passed, rejected };
}

function firstFailure(
  pool: CandidatePool,
  th: ScreeningThresholds,
  ctx: FilterContext,
): RejectionReason | null {
  if (pool.tvl < th.minTvl || pool.tvl > th.maxTvl) {
    return { kind: "tvl_out_of_range", value: pool.tvl, min: th.minTvl, max: th.maxTvl };
  }
  if (pool.volume_window < th.minVolume) {
    return { kind: "volume_below_min", value: pool.volume_window, min: th.minVolume };
  }
  const organic = pool.organic_score ?? 0;
  if (organic < th.minOrganic) {
    return { kind: "organic_below_min", value: organic, min: th.minOrganic };
  }
  const holders = pool.holders ?? 0;
  if (holders < th.minHolders) {
    return { kind: "holders_below_min", value: holders, min: th.minHolders };
  }
  if (pool.mcap != null && (pool.mcap < th.minMcap || pool.mcap > th.maxMcap)) {
    return { kind: "mcap_out_of_range", value: pool.mcap, min: th.minMcap, max: th.maxMcap };
  }
  if (pool.bin_step != null && (pool.bin_step < th.minBinStep || pool.bin_step > th.maxBinStep)) {
    return {
      kind: "bin_step_out_of_range",
      value: pool.bin_step,
      min: th.minBinStep,
      max: th.maxBinStep,
    };
  }
  const feeTvl = pool.fee_active_tvl_ratio ?? pool.fee_tvl_ratio ?? 0;
  if (feeTvl < th.minFeeActiveTvlRatio) {
    return { kind: "fee_tvl_below_min", value: feeTvl, min: th.minFeeActiveTvlRatio };
  }
  if (pool.launchpad && th.blockedLaunchpads.includes(pool.launchpad)) {
    return { kind: "launchpad_blocked", value: pool.launchpad };
  }
  if (
    th.allowedLaunchpads.length > 0 &&
    (!pool.launchpad || !th.allowedLaunchpads.includes(pool.launchpad))
  ) {
    return { kind: "launchpad_not_allowed", value: pool.launchpad ?? "", allowed: th.allowedLaunchpads };
  }
  if (pool.token_age_hours != null) {
    const minAge = th.minTokenAgeHours;
    const maxAge = th.maxTokenAgeHours;
    if (
      (minAge != null && pool.token_age_hours < minAge) ||
      (maxAge != null && pool.token_age_hours > maxAge)
    ) {
      return {
        kind: "token_age_out_of_range",
        value: pool.token_age_hours,
        min: minAge,
        max: maxAge,
      };
    }
  }
  if (ctx.onPoolCooldown(pool)) return { kind: "on_pool_cooldown" };
  if (ctx.onBaseMintCooldown(pool)) return { kind: "on_base_mint_cooldown" };
  if (ctx.isBlacklisted(pool.base_mint)) return { kind: "base_mint_blacklisted" };
  if (ctx.baseMintsInUse.has(pool.base_mint)) return { kind: "base_mint_already_in_use" };
  return null;
}

export interface RankedPool {
  pool: CandidatePool;
  score: number;
}

/** Pure — sort by scoreCandidate (Phase 1), descending. */
export function rankCandidates(pools: readonly CandidatePool[]): RankedPool[] {
  return pools
    .map((p) => ({ pool: p, score: scoreCandidate(p) }))
    .sort((a, b) => b.score - a.score);
}

/** Summarize the top rejection reasons — for decision-log entries when 0 pass. */
export function summarizeRejections(
  rejected: FilterResult["rejected"],
  limit = 8,
): string[] {
  const counts = new Map<string, number>();
  for (const r of rejected) {
    counts.set(r.reason.kind, (counts.get(r.reason.kind) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([kind, n]) => `${kind} (${n})`);
}
