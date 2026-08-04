import { z } from "zod";

export const ManagementConfigSchema = z.object({
  stopLossPct: z.number(),
  takeProfitPct: z.number(),
  outOfRangeWaitMinutes: z.number().int().nonnegative(),
  minFeePerTvl24h: z.number().nonnegative(),
  minAgeBeforeYieldCheck: z.number().int().nonnegative(),
  minClaimAmount: z.number().nonnegative(),
  trailingTakeProfit: z.boolean(),
  trailingTriggerPct: z.number(),
  trailingDropPct: z.number().positive(),
  deployAmountSol: z.number().positive(),
  gasReserve: z.number().nonnegative(),
  positionSizePct: z.number().positive().max(1),
  pnlSanityMaxDiffPct: z.number().positive(),
  solMode: z.boolean(),
  autoSwapSlippageBps: z.number().int().min(1).max(10_000).default(300),
  autoSwapMinUsd: z.number().nonnegative().default(0.5),
  consolidateRetries: z.number().int().min(1).max(20).default(5),
  consolidateRetryDelayMs: z.number().int().min(0).max(30_000).default(3_000),
  dustSweepEnabled: z.boolean().default(true),
  dustSweepIntervalMin: z.number().int().min(1).max(1440).default(5),
  dustSweepMinUsd: z.number().nonnegative().default(0.01),
  dustSweepSlippageBps: z.number().int().min(1).max(10_000).default(500),
});
export type ManagementConfig = z.infer<typeof ManagementConfigSchema>;

export const RiskConfigSchema = z.object({
  maxPositions: z.number().int().positive(),
});
export type RiskConfig = z.infer<typeof RiskConfigSchema>;

export const StrategyConfigSchema = z.object({
  /** AI default only — Sage overrides per candidate. Kept for legacy fallback + Telegram REPL. */
  strategy: z.enum(["spot", "curve", "bid_ask"]),
  binsBelow: z.number().int().min(35),
});
export type StrategyConfig = z.infer<typeof StrategyConfigSchema>;

export const ScheduleConfigSchema = z.object({
  managementIntervalMin: z.number().int().positive(),
  screeningIntervalMin: z.number().int().positive(),
  healthCheckIntervalMin: z.number().int().positive(),
});
export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;

/** Screening filters — mirrors config.js `screening` section (flat keys in user-config.json). */
export const ScreeningConfigSchema = z.object({
  excludeHighSupplyConcentration: z.boolean(),
  minFeeActiveTvlRatio: z.number().nonnegative(),
  minTvl: z.number().nonnegative(),
  maxTvl: z.number().nonnegative(),
  minVolume: z.number().nonnegative(),
  minOrganic: z.number().nonnegative(),
  minQuoteOrganic: z.number().nonnegative(),
  minHolders: z.number().int().nonnegative(),
  minMcap: z.number().nonnegative(),
  maxMcap: z.number().nonnegative(),
  minBinStep: z.number().int().nonnegative(),
  maxBinStep: z.number().int().nonnegative(),
  timeframe: z.string(),
  category: z.string(),
  maxBotHoldersPct: z.number().min(0).max(100),
  maxTop10Pct: z.number().min(0).max(100),
  allowedLaunchpads: z.array(z.string()),
  blockedLaunchpads: z.array(z.string()),
  minTokenAgeHours: z.number().nonnegative().nullable(),
  maxTokenAgeHours: z.number().nonnegative().nullable(),
});
export type ScreeningConfig = z.infer<typeof ScreeningConfigSchema>;

export const LlmConfigSchema = z.object({
  temperature: z.number().min(0),
  maxTokens: z.number().int().positive(),
  maxSteps: z.number().int().positive(),
  managementModel: z.string(),
  screeningModel: z.string(),
  generalModel: z.string(),
});
export type LlmConfig = z.infer<typeof LlmConfigSchema>;

export const HiveMindConfigSchema = z.object({
  url: z.string(),
  apiKey: z.string(),
  agentId: z.string(),
  pullMode: z.enum(["auto", "manual"]),
});
export type HiveMindConfig = z.infer<typeof HiveMindConfigSchema>;

export const ApiConfigSchema = z.object({
  url: z.string(),
  publicApiKey: z.string(),
});
export type ApiConfig = z.infer<typeof ApiConfigSchema>;

export const JupiterConfigSchema = z.object({
  referralAccount: z.string().default(""),
  referralFeeBps: z.number().int().min(0).max(10_000).default(50),
});
export type JupiterConfig = z.infer<typeof JupiterConfigSchema>;

/** Canonical Solana mint addresses — used by swap normalization + reference. */
export const TokensConfigSchema = z.object({
  SOL: z.string().default("So11111111111111111111111111111111111111112"),
  USDC: z.string().default("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  USDT: z.string().default("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
});
export type TokensConfig = z.infer<typeof TokensConfigSchema>;

export const AppConfigSchema = z.object({
  risk: RiskConfigSchema,
  management: ManagementConfigSchema,
  strategy: StrategyConfigSchema,
  schedule: ScheduleConfigSchema,
  screening: ScreeningConfigSchema,
  llm: LlmConfigSchema,
  hiveMind: HiveMindConfigSchema,
  api: ApiConfigSchema,
  jupiter: JupiterConfigSchema,
  tokens: TokensConfigSchema,
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const MIN_SAFE_BINS_BELOW = 35 as const;
