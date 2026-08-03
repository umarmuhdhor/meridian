import { z } from "zod";

/**
 * The raw shape of user-config.json as it exists on disk today — a flat bag of keys.
 * We accept unknown extras via `.passthrough()` so encrypted / experimental keys pass
 * through untouched; the domain layer reads only what it knows about.
 *
 * New (non-Phase-1) sections — screening, llm, darwin, hiveMind, api, jupiter, indicators,
 * tokens, pnl — are entirely optional-with-defaults so pre-existing user-config.json files
 * (which don't carry them) keep parsing without change.
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
    autoSwapSlippageBps: z.number().int().min(1).max(10_000).default(300),
    autoSwapMinUsd: z.number().nonnegative().default(0.5),
    consolidateRetries: z.number().int().min(1).max(20).default(5),
    consolidateRetryDelayMs: z.number().int().min(0).max(30_000).default(3_000),
    dustSweepEnabled: z.boolean().default(true),
    dustSweepIntervalMin: z.number().int().min(1).max(1440).default(5),
    dustSweepMinUsd: z.number().nonnegative().default(0.01),
    dustSweepSlippageBps: z.number().int().min(1).max(10_000).default(500),

    // strategy
    strategy: z.enum(["spot", "curve", "bid_ask"]),
    minBinsBelow: z.number().int().min(35),
    maxBinsBelow: z.number().int().min(35),
    defaultBinsBelow: z.number().int().min(35),

    // schedule
    managementIntervalMin: z.number().int().positive(),
    screeningIntervalMin: z.number().int().positive(),
    healthCheckIntervalMin: z.number().int().positive(),

    // screening
    excludeHighSupplyConcentration: z.boolean().default(true),
    minFeeActiveTvlRatio: z.number().nonnegative().default(0.05),
    minTvl: z.number().nonnegative().default(10_000),
    maxTvl: z.number().nonnegative().default(150_000),
    minVolume: z.number().nonnegative().default(500),
    minOrganic: z.number().nonnegative().default(60),
    minQuoteOrganic: z.number().nonnegative().default(60),
    minHolders: z.number().int().nonnegative().default(500),
    minMcap: z.number().nonnegative().default(150_000),
    maxMcap: z.number().nonnegative().default(10_000_000),
    minBinStep: z.number().int().nonnegative().default(80),
    maxBinStep: z.number().int().nonnegative().default(125),
    timeframe: z.string().default("5m"),
    category: z.string().default("trending"),
    minTokenFeesSol: z.number().nonnegative().default(30),
    useDiscordSignals: z.boolean().default(false),
    discordSignalMode: z.enum(["merge", "only"]).default("merge"),
    avoidPvpSymbols: z.boolean().default(true),
    blockPvpSymbols: z.boolean().default(false),
    maxBotHoldersPct: z.number().min(0).max(100).default(30),
    maxTop10Pct: z.number().min(0).max(100).default(60),
    allowedLaunchpads: z.array(z.string()).default([]),
    blockedLaunchpads: z.array(z.string()).default([]),
    minTokenAgeHours: z.number().nonnegative().nullable().default(null),
    maxTokenAgeHours: z.number().nonnegative().nullable().default(null),

    // llm
    temperature: z.number().min(0).default(0.373),
    maxTokens: z.number().int().positive().default(4096),
    maxSteps: z.number().int().positive().default(20),
    managementModel: z.string().default("healer-alpha"),
    screeningModel: z.string().default("hunter-alpha"),
    generalModel: z.string().default("healer-alpha"),

    // darwin
    darwinEnabled: z.boolean().default(true),
    darwinWindowDays: z.number().int().positive().default(60),
    darwinRecalcEvery: z.number().int().positive().default(5),
    darwinBoost: z.number().positive().default(1.05),
    darwinDecay: z.number().positive().default(0.95),
    darwinFloor: z.number().positive().default(0.3),
    darwinCeiling: z.number().positive().default(2.5),
    darwinMinSamples: z.number().int().positive().default(10),

    // hiveMind
    hiveMindUrl: z.string().default("https://api.agentmeridian.xyz"),
    hiveMindApiKey: z.string().default(""),
    agentId: z.string().default(""),
    hiveMindPullMode: z.enum(["auto", "manual"]).default("auto"),

    // api
    agentMeridianApiUrl: z.string().default("https://api.agentmeridian.xyz/api"),
    publicApiKey: z.string().default(""),
    lpAgentRelayEnabled: z.boolean().default(false),

    // jupiter — mostly env-driven; kept optional in the flat file
    jupiterApiKey: z.string().default(""),
    jupiterReferralAccount: z.string().default(""),
    jupiterReferralFeeBps: z.number().int().min(0).max(10_000).default(50),

    // indicators — nested block in the flat file
    chartIndicators: z
      .object({
        enabled: z.boolean().default(false),
        entryPreset: z.string().default("supertrend_break"),
        exitPreset: z.string().default("supertrend_break"),
        rsiLength: z.number().int().positive().default(2),
        intervals: z.array(z.string()).default(["5_MINUTE"]),
        candles: z.number().int().positive().default(298),
        rsiOversold: z.number().min(0).max(100).default(30),
        rsiOverbought: z.number().min(0).max(100).default(80),
        requireAllIntervals: z.boolean().default(false),
      })
      .default({}),

    // pnl source
    pnlSource: z.enum(["rpc", "meteora"]).default("rpc"),
    pnlRpcUrl: z.string().default("https://pump.helius-rpc.com"),
    pnlPollIntervalSec: z.number().int().positive().default(3),
    pnlDepositCacheTtlSec: z.number().int().nonnegative().default(300),
  })
  .passthrough();
export type FlatUserConfig = z.infer<typeof FlatUserConfigSchema>;
