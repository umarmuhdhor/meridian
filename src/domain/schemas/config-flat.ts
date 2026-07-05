import { z } from "zod";

/**
 * The raw shape of user-config.json as it exists on disk today — a flat bag of keys.
 * We accept unknown extras via `.passthrough()` so encrypted / experimental keys pass
 * through untouched; the domain layer reads only what it knows about.
 */
export const FlatUserConfigSchema = z
  .object({
    // risk / management
    maxPositions: z.number().int().positive(),
    maxDeployAmount: z.number().positive(),
    stopLossPct: z.number(),
    takeProfitPct: z.number(),
    outOfRangeBinsToClose: z.number().int().nonnegative(),
    outOfRangeWaitMinutes: z.number().int().nonnegative(),
    oorCooldownTriggerCount: z.number().int().positive(),
    oorCooldownHours: z.number().positive(),
    minFeePerTvl24h: z.number().nonnegative(),
    minAgeBeforeYieldCheck: z.number().int().nonnegative(),
    minClaimAmount: z.number().nonnegative(),
    trailingTakeProfit: z.boolean(),
    trailingTriggerPct: z.number(),
    trailingDropPct: z.number().positive(),
    deployAmountSol: z.number().positive(),
    gasReserve: z.number().nonnegative(),
    positionSizePct: z.number().positive().max(1),
    minSolToOpen: z.number().nonnegative(),
    pnlSanityMaxDiffPct: z.number().positive(),
    solMode: z.boolean(),
    repeatDeployCooldownEnabled: z.boolean().default(true),
    repeatDeployCooldownTriggerCount: z.number().int().positive().default(3),
    repeatDeployCooldownHours: z.number().positive().default(12),
    repeatDeployCooldownScope: z.enum(["token", "pool", "pool_and_token"]).default("token"),
    repeatDeployCooldownMinFeeEarnedPct: z.number().nonnegative().default(1.5),

    // strategy
    strategy: z.enum(["spot", "curve", "bid_ask"]),
    minBinsBelow: z.number().int().min(35),
    maxBinsBelow: z.number().int().min(35),
    defaultBinsBelow: z.number().int().min(35),

    // schedule
    managementIntervalMin: z.number().int().positive(),
    screeningIntervalMin: z.number().int().positive(),
    healthCheckIntervalMin: z.number().int().positive(),
  })
  .passthrough();
export type FlatUserConfig = z.infer<typeof FlatUserConfigSchema>;
