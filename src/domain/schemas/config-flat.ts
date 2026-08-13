import { z } from "zod";

/**
 * The raw shape of user-config.json as it exists on disk today — a flat bag of keys.
 * We accept unknown extras via `.passthrough()` so encrypted / experimental keys pass
 * through untouched; the domain layer reads only what it knows about.
 *
 * Kept intentionally minimal — only keys the daemon actually reads. Config-audit
 * (2026-08-04) removed ~40 keys that had zero read sites in `src/`, and collapsed
 * three overlaps (`risk.maxDeployAmount` → merged into `deployAmountSol`,
 * `outOfRangeBinsToClose` dropped in favour of the time trigger, `maxBinsBelow` /
 * `minBinsBelow` collapsed into a single `binsBelow`).
 */
export const FlatUserConfigSchema = z
  .object({
    // risk / management
    maxPositions: z.number().int().positive(),
    stopLossPct: z.number(),
    stopLossGraceMinutes: z.number().int().nonnegative().default(30),
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
    /** Telegram `/deploy` REPL-only — fraction of wallet SOL sized per position. */
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

    // redeploy cooldown — every successful close writes cooldown_until on the pool
    // memory entry so the same pool can't be redeployed inside the window. scope
    // "token" also writes base_mint_cooldown_until (blocks ALL pools for that token).
    // Prevents the "daemon redeployed a token Sage just closed at a loss" class of bug.
    repeatDeployCooldownEnabled: z.boolean().default(true),
    repeatDeployCooldownHours: z.number().nonnegative().default(12),
    repeatDeployCooldownScope: z.enum(["pool", "token"]).default("token"),

    // strategy — Sage picks per candidate (see screening/cycle.ts). `strategy` here
    // is only the fallback for legacy positions / Telegram REPL, and the label the
    // dashboard shows as the "AI default".
    strategy: z.enum(["spot", "curve", "bid_ask"]),
    binsBelow: z.number().int().min(35),

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
    maxBotHoldersPct: z.number().min(0).max(100).default(30),
    maxTop10Pct: z.number().min(0).max(100).default(60),
    maxAtrPct: z.number().min(0).default(20),
    maxSpikePct: z.number().min(0).default(25),
    rejectOnMissingTrend: z.boolean().default(true),
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

    // hiveMind
    hiveMindUrl: z.string().default("https://api.agentmeridian.xyz"),
    hiveMindApiKey: z.string().default(""),
    agentId: z.string().default(""),
    hiveMindPullMode: z.enum(["auto", "manual"]).default("auto"),

    // api
    agentMeridianApiUrl: z.string().default("https://api.agentmeridian.xyz/api"),
    publicApiKey: z.string().default(""),

    // jupiter — env-driven; kept optional in the flat file
    jupiterReferralAccount: z.string().default(""),
    jupiterReferralFeeBps: z.number().int().min(0).max(10_000).default(50),
  })
  .passthrough();
export type FlatUserConfig = z.infer<typeof FlatUserConfigSchema>;
