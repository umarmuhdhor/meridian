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
  minTokenFeesSol: z.number().nonnegative(),
  useDiscordSignals: z.boolean(),
  discordSignalMode: z.enum(["merge", "only"]),
  avoidPvpSymbols: z.boolean(),
  blockPvpSymbols: z.boolean(),
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

export const DarwinConfigSchema = z.object({
  enabled: z.boolean(),
  windowDays: z.number().int().positive(),
  recalcEvery: z.number().int().positive(),
  boostFactor: z.number().positive(),
  decayFactor: z.number().positive(),
  weightFloor: z.number().positive(),
  weightCeiling: z.number().positive(),
  minSamples: z.number().int().positive(),
});
export type DarwinConfig = z.infer<typeof DarwinConfigSchema>;

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
  lpAgentRelayEnabled: z.boolean(),
});
export type ApiConfig = z.infer<typeof ApiConfigSchema>;

export const JupiterConfigSchema = z.object({
  apiKey: z.string().default(""),
  referralAccount: z.string().default(""),
  referralFeeBps: z.number().int().min(0).max(10_000).default(50),
});
export type JupiterConfig = z.infer<typeof JupiterConfigSchema>;

export const IndicatorsConfigSchema = z.object({
  enabled: z.boolean(),
  entryPreset: z.string(),
  exitPreset: z.string(),
  rsiLength: z.number().int().positive(),
  intervals: z.array(z.string()),
  candles: z.number().int().positive(),
  rsiOversold: z.number().min(0).max(100),
  rsiOverbought: z.number().min(0).max(100),
  requireAllIntervals: z.boolean(),
});
export type IndicatorsConfig = z.infer<typeof IndicatorsConfigSchema>;

/** Canonical Solana mint addresses — used by swap normalization + reference. */
export const TokensConfigSchema = z.object({
  SOL: z.string().default("So11111111111111111111111111111111111111112"),
  USDC: z.string().default("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  USDT: z.string().default("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
});
export type TokensConfig = z.infer<typeof TokensConfigSchema>;

export const PnlSourceConfigSchema = z.object({
  source: z.enum(["rpc", "meteora"]),
  rpcUrl: z.string(),
  pollIntervalSec: z.number().int().positive(),
  depositCacheTtlSec: z.number().int().nonnegative(),
});
export type PnlSourceConfig = z.infer<typeof PnlSourceConfigSchema>;

export const AppConfigSchema = z.object({
  risk: RiskConfigSchema,
  management: ManagementConfigSchema,
  strategy: StrategyConfigSchema,
  schedule: ScheduleConfigSchema,
  screening: ScreeningConfigSchema,
  llm: LlmConfigSchema,
  darwin: DarwinConfigSchema,
  hiveMind: HiveMindConfigSchema,
  api: ApiConfigSchema,
  jupiter: JupiterConfigSchema,
  indicators: IndicatorsConfigSchema,
  tokens: TokensConfigSchema,
  pnl: PnlSourceConfigSchema,
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const MIN_SAFE_BINS_BELOW = 35 as const;
