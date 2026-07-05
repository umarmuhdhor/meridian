import { z } from "zod";
import { defineTool } from "../define-tool.js";

const ArgsSchema = z.object({
  pool_address: z.string().min(1).describe("The Meteora DLMM pool address to look up."),
});

const KnownResultSchema = z.object({
  pool_address: z.string(),
  known: z.literal(true),
  name: z.string(),
  base_mint: z.string().nullable(),
  total_deploys: z.number().int(),
  avg_pnl_pct: z.number(),
  win_rate: z.number(),
  adjusted_win_rate: z.number(),
  adjusted_win_rate_sample_count: z.number().int(),
  last_deployed_at: z.string().nullable(),
  last_outcome: z.string().nullable(),
  cooldown_until: z.string().nullable(),
  cooldown_reason: z.string().nullable(),
  base_mint_cooldown_until: z.string().nullable(),
  base_mint_cooldown_reason: z.string().nullable(),
  notes: z.array(z.string()),
  history_count: z.number().int().nonnegative(),
});

const UnknownResultSchema = z.object({
  pool_address: z.string(),
  known: z.literal(false),
  message: z.string(),
});

const ResultSchema = z.discriminatedUnion("known", [KnownResultSchema, UnknownResultSchema]);
const HISTORY_LIMIT = 10;

export const getPoolMemoryTool = defineTool({
  name: "get_pool_memory",
  description:
    "Return deploy history + cooldown state for a Meteora DLMM pool. Use before deploying to check for prior losses, low-yield cooldowns, or OOR-triggered blocks.",
  args: ArgsSchema,
  result: ResultSchema,
  execute: async ({ pool_address }, ctx) => {
    const entry = await ctx.repos.poolMemory.get(pool_address);
    if (!entry) {
      return {
        pool_address,
        known: false as const,
        message: "No history for this pool — first time deploying here.",
      };
    }
    const history = entry.deploys.slice(-HISTORY_LIMIT);
    return {
      pool_address,
      known: true as const,
      name: entry.name,
      base_mint: entry.base_mint,
      total_deploys: entry.total_deploys,
      avg_pnl_pct: entry.avg_pnl_pct,
      win_rate: entry.win_rate,
      adjusted_win_rate: entry.adjusted_win_rate,
      adjusted_win_rate_sample_count: entry.adjusted_win_rate_sample_count,
      last_deployed_at: entry.last_deployed_at,
      last_outcome: entry.last_outcome,
      cooldown_until: entry.cooldown_until ?? null,
      cooldown_reason: entry.cooldown_reason ?? null,
      base_mint_cooldown_until: entry.base_mint_cooldown_until ?? null,
      base_mint_cooldown_reason: entry.base_mint_cooldown_reason ?? null,
      notes: entry.notes,
      history_count: history.length,
    };
  },
});
