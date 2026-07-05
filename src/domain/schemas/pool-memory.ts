import { z } from "zod";

export const PoolDeploySchema = z.object({
  position: z.string().optional(),
  deployed_at: z.string(),
  closed_at: z.string(),
  pnl_pct: z.number(),
  pnl_usd: z.number().optional(),
  fees_earned_usd: z.number().nonnegative().optional(),
  fees_earned_sol: z.number().nonnegative().optional(),
  fee_earned_pct: z.number().optional(),
  range_efficiency: z.number().optional(),
  minutes_held: z.number().int().nonnegative().optional(),
  close_reason: z.string(),
  strategy: z.enum(["spot", "curve", "bid_ask"]).optional(),
  volatility: z.number().optional(),
});
export type PoolDeploy = z.infer<typeof PoolDeploySchema>;

export const PoolMemoryEntrySchema = z.object({
  name: z.string(),
  base_mint: z.string().nullable(),
  deploys: z.array(PoolDeploySchema).default([]),
  total_deploys: z.number().int().nonnegative().default(0),
  avg_pnl_pct: z.number().default(0),
  win_rate: z.number().default(0),
  adjusted_win_rate: z.number().default(0),
  adjusted_win_rate_sample_count: z.number().int().nonnegative().default(0),
  last_deployed_at: z.string().nullable().default(null),
  last_outcome: z.string().nullable().default(null),
  cooldown_until: z.string().nullable().optional(),
  cooldown_reason: z.string().nullable().optional(),
  base_mint_cooldown_until: z.string().nullable().optional(),
  base_mint_cooldown_reason: z.string().nullable().optional(),
  notes: z.array(z.string()).default([]),
  snapshots: z.array(z.unknown()).default([]),
});
export type PoolMemoryEntry = z.infer<typeof PoolMemoryEntrySchema>;

export const PoolMemoryDbSchema = z.record(z.string(), PoolMemoryEntrySchema);
export type PoolMemoryDb = z.infer<typeof PoolMemoryDbSchema>;
