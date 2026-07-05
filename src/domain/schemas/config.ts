import { z } from "zod";

export const ManagementConfigSchema = z.object({
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
  repeatDeployCooldownEnabled: z.boolean(),
  repeatDeployCooldownTriggerCount: z.number().int().positive(),
  repeatDeployCooldownHours: z.number().positive(),
  repeatDeployCooldownScope: z.enum(["token", "pool", "pool_and_token"]),
  repeatDeployCooldownMinFeeEarnedPct: z.number().nonnegative(),
});
export type ManagementConfig = z.infer<typeof ManagementConfigSchema>;

export const RiskConfigSchema = z.object({
  maxPositions: z.number().int().positive(),
  maxDeployAmount: z.number().positive(),
});
export type RiskConfig = z.infer<typeof RiskConfigSchema>;

export const StrategyConfigSchema = z.object({
  strategy: z.enum(["spot", "curve", "bid_ask"]),
  minBinsBelow: z.number().int().min(35),
  maxBinsBelow: z.number().int().min(35),
  defaultBinsBelow: z.number().int().min(35),
});
export type StrategyConfig = z.infer<typeof StrategyConfigSchema>;

export const ScheduleConfigSchema = z.object({
  managementIntervalMin: z.number().int().positive(),
  screeningIntervalMin: z.number().int().positive(),
  healthCheckIntervalMin: z.number().int().positive(),
});
export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;

export const AppConfigSchema = z.object({
  risk: RiskConfigSchema,
  management: ManagementConfigSchema,
  strategy: StrategyConfigSchema,
  schedule: ScheduleConfigSchema,
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const MIN_SAFE_BINS_BELOW = 35 as const;
