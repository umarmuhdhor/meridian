import { z } from "zod";

export const TrackedPositionSchema = z.object({
  position: z.string(),
  pool: z.string(),
  pool_name: z.string().nullable().optional(),
  strategy: z.enum(["spot", "curve", "bid_ask"]),
  bin_range: z
    .object({
      lower_bin: z.number().int().optional(),
      upper_bin: z.number().int().optional(),
    })
    .partial()
    .optional(),
  amount_sol: z.number().nonnegative(),
  amount_x: z.number().nonnegative().optional(),
  active_bin_at_deploy: z.number().int().nullable().optional(),
  bin_step: z.number().int().nullable().optional(),
  volatility: z.number().nullable().optional(),
  fee_tvl_ratio: z.number().nullable().optional(),
  initial_fee_tvl_24h: z.number().nullable().optional(),
  organic_score: z.number().nullable().optional(),
  initial_value_usd: z.number().nullable().optional(),
  /** Base-token market cap at deploy time (USD). */
  entry_mcap: z.number().nullable().optional(),
  /** Base-token holder count at deploy time. */
  holders_at_entry: z.number().int().nonnegative().nullable().optional(),
  /** Whether at least one smart wallet was in the pool at deploy time. */
  smart_wallets_present: z.boolean().nullable().optional(),
  deployed_at: z.string(),
  out_of_range_since: z.string().nullable(),
  last_claim_at: z.string().nullable(),
  total_fees_claimed_usd: z.number().nonnegative(),
  rebalance_count: z.number().int().nonnegative(),
  closed: z.boolean(),
  closed_at: z.string().nullable(),
  notes: z.array(z.string()),
  peak_pnl_pct: z.number().default(0),
  pending_peak_pnl_pct: z.number().nullable().optional(),
  pending_peak_confirm_count: z.number().int().nonnegative().optional(),
  pending_peak_started_at: z.string().nullable().optional(),
  pending_exit_action: z.string().nullable().optional(),
  pending_exit_count: z.number().int().nonnegative().optional(),
  pending_exit_started_at: z.string().nullable().optional(),
  trailing_active: z.boolean().default(false),
  instruction: z.string().nullable().optional(),
});
export type TrackedPosition = z.infer<typeof TrackedPositionSchema>;

export const LivePositionSnapshotSchema = z.object({
  position: z.string(),
  pair: z.string().optional(),
  pnl_pct: z.number().nullable(),
  pnl_pct_suspicious: z.boolean().default(false),
  total_value_usd: z.number().nullable().optional(),
  in_range: z.boolean().nullable().optional(),
  active_bin: z.number().int().nullable().optional(),
  upper_bin: z.number().int().nullable().optional(),
  lower_bin: z.number().int().nullable().optional(),
  minutes_out_of_range: z.number().int().nonnegative().nullable().optional(),
  fee_per_tvl_24h: z.number().nullable().optional(),
  age_minutes: z.number().int().nonnegative().nullable().optional(),
});
export type LivePositionSnapshot = z.infer<typeof LivePositionSnapshotSchema>;
