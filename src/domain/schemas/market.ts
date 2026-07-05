import { z } from "zod";

/** Raw candidate pool as returned by a discovery source before hard-filter + enrichment. */
export const CandidatePoolSchema = z
  .object({
    pool_address: z.string(),
    name: z.string(),
    base_mint: z.string(),
    quote_mint: z.string().default("So11111111111111111111111111111111111111112"),
    tvl: z.number().nonnegative(),
    active_tvl: z.number().nonnegative().optional(),
    volume_window: z.number().nonnegative(),
    fee_active_tvl_ratio: z.number().optional(),
    fee_tvl_ratio: z.number().optional(),
    organic_score: z.number().optional(),
    holders: z.number().int().nonnegative().optional(),
    mcap: z.number().nonnegative().optional(),
    bin_step: z.number().int().nonnegative().optional(),
    volatility: z.number().optional(),
    launchpad: z.string().nullable().default(null),
    token_age_hours: z.number().nonnegative().nullable().default(null),
    active_pct: z.number().nullable().default(null),
  })
  .passthrough();
export type CandidatePool = z.infer<typeof CandidatePoolSchema>;

export const TokenInfoSchema = z
  .object({
    mint: z.string(),
    symbol: z.string().nullable().default(null),
    name: z.string().nullable().default(null),
    launchpad: z.string().nullable().default(null),
    deployer: z.string().nullable().default(null),
    supply: z.number().nonnegative().nullable().default(null),
    mcap: z.number().nonnegative().nullable().default(null),
    holders: z.number().int().nonnegative().nullable().default(null),
    age_hours: z.number().nonnegative().nullable().default(null),
  })
  .passthrough();
export type TokenInfo = z.infer<typeof TokenInfoSchema>;

export const TokenHolderSchema = z.object({
  address: z.string(),
  pct: z.number().nonnegative(),
  amount: z.number().nonnegative().optional(),
  label: z.string().nullable().default(null),
});
export type TokenHolder = z.infer<typeof TokenHolderSchema>;

export const TokenHoldersSummarySchema = z.object({
  mint: z.string(),
  count: z.number().int().nonnegative(),
  top10_pct: z.number().nonnegative(),
  bot_pct: z.number().nonnegative(),
  top: z.array(TokenHolderSchema),
});
export type TokenHoldersSummary = z.infer<typeof TokenHoldersSummarySchema>;

export const TokenNarrativeSchema = z.object({
  mint: z.string(),
  narrative: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
});
export type TokenNarrative = z.infer<typeof TokenNarrativeSchema>;

export const RugCheckResultSchema = z.object({
  mint: z.string(),
  score: z.number(),
  top10_pct: z.number().nonnegative(),
  passes: z.boolean(),
  reason: z.string().nullable().default(null),
});
export type RugCheckResult = z.infer<typeof RugCheckResultSchema>;

export const SmartWalletMatchSchema = z.object({
  name: z.string(),
  address: z.string(),
  category: z.string().nullable().default(null),
  type: z.enum(["lp", "holder"]),
  matched_via: z.enum(["position", "holding"]),
});
export type SmartWalletMatch = z.infer<typeof SmartWalletMatchSchema>;
