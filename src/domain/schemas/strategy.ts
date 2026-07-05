import { z } from "zod";

export const StrategyEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  author: z.string().nullable().default(null),
  lp_strategy: z.string(),
  token_criteria: z.string().nullable().default(null),
  entry: z.string().nullable().default(null),
  range: z.string().nullable().default(null),
  exit: z.string().nullable().default(null),
  best_for: z.string().nullable().default(null),
  raw: z.string().nullable().default(null),
});
export type StrategyEntry = z.infer<typeof StrategyEntrySchema>;

export const StrategyLibrarySchema = z.object({
  active: z.string().default("custom_ratio_spot"),
  strategies: z.record(z.string(), StrategyEntrySchema).default({}),
});
export type StrategyLibrary = z.infer<typeof StrategyLibrarySchema>;

/** Five defaults from strategy-library.js — kept in TS as the source of truth. */
export function defaultStrategyLibrary(): StrategyLibrary {
  const s = (
    id: string,
    name: string,
    lp: string,
    tokenCriteria: string,
    entry: string,
    range: string,
    exit: string,
    bestFor: string,
  ): StrategyEntry => ({
    id,
    name,
    author: null,
    lp_strategy: lp,
    token_criteria: tokenCriteria,
    entry,
    range,
    exit,
    best_for: bestFor,
    raw: null,
  });
  return {
    active: "custom_ratio_spot",
    strategies: {
      custom_ratio_spot: s(
        "custom_ratio_spot",
        "Custom Ratio Spot",
        "spot",
        "any",
        "at active bin",
        "symmetric around active",
        "manual close or trailing TP",
        "expressing directional bias via token:SOL ratio",
      ),
      single_sided_reseed: s(
        "single_sided_reseed",
        "Single-Sided Bid-Ask + Re-seed",
        "bid_ask",
        "high volatility, medium liquidity",
        "single-sided below range",
        "wide bins below active",
        "re-seed on OOR downside",
        "token-only redeploys on drops",
      ),
      fee_compounding: s(
        "fee_compounding",
        "Fee Compounding",
        "any",
        "high fee/TVL pools",
        "at active bin",
        "narrow around active",
        "claim + add back to same position",
        "high-yield pools with stable price",
      ),
      multi_layer: s(
        "multi_layer",
        "Multi-Layer",
        "mixed",
        "range-bound pools",
        "layered deposits at different bins",
        "multiple bin ranges",
        "layer-specific triggers",
        "one position with multiple shape layers",
      ),
      partial_harvest: s(
        "partial_harvest",
        "Partial Harvest",
        "any",
        "any",
        "at active bin",
        "wide around active",
        "withdraw 50% at 10% return; rest runs",
        "capturing upside while reducing risk",
      ),
    },
  };
}
