import { AppConfigSchema, type AppConfig } from "./schemas/config.js";
import { FlatUserConfigSchema, type FlatUserConfig } from "./schemas/config-flat.js";
import { err, ok, type Result } from "../shared/result.js";
import { z } from "zod";

export type ConfigLoadError =
  | { kind: "flat_invalid"; issues: z.ZodIssue[] }
  | { kind: "nested_invalid"; issues: z.ZodIssue[] };

/**
 * Pure — map the flat user-config.json shape to the nested AppConfig the domain reads.
 * The JS runtime today builds the same nested `config` object at load time in config.js;
 * this port makes the transform explicit and validates both sides via Zod.
 */
export function flatToNested(flat: FlatUserConfig): AppConfig {
  return {
    risk: {
      maxPositions: flat.maxPositions,
      maxDeployAmount: flat.maxDeployAmount,
    },
    management: {
      stopLossPct: flat.stopLossPct,
      takeProfitPct: flat.takeProfitPct,
      outOfRangeBinsToClose: flat.outOfRangeBinsToClose,
      outOfRangeWaitMinutes: flat.outOfRangeWaitMinutes,
      oorCooldownTriggerCount: flat.oorCooldownTriggerCount,
      oorCooldownHours: flat.oorCooldownHours,
      minFeePerTvl24h: flat.minFeePerTvl24h,
      minAgeBeforeYieldCheck: flat.minAgeBeforeYieldCheck,
      minClaimAmount: flat.minClaimAmount,
      trailingTakeProfit: flat.trailingTakeProfit,
      trailingTriggerPct: flat.trailingTriggerPct,
      trailingDropPct: flat.trailingDropPct,
      deployAmountSol: flat.deployAmountSol,
      gasReserve: flat.gasReserve,
      positionSizePct: flat.positionSizePct,
      minSolToOpen: flat.minSolToOpen,
      pnlSanityMaxDiffPct: flat.pnlSanityMaxDiffPct,
      solMode: flat.solMode,
      repeatDeployCooldownEnabled: flat.repeatDeployCooldownEnabled,
      repeatDeployCooldownTriggerCount: flat.repeatDeployCooldownTriggerCount,
      repeatDeployCooldownHours: flat.repeatDeployCooldownHours,
      repeatDeployCooldownScope: flat.repeatDeployCooldownScope,
      repeatDeployCooldownMinFeeEarnedPct: flat.repeatDeployCooldownMinFeeEarnedPct,
      autoSwapSlippageBps: flat.autoSwapSlippageBps,
      autoSwapMinUsd: flat.autoSwapMinUsd,
      consolidateRetries: flat.consolidateRetries,
      consolidateRetryDelayMs: flat.consolidateRetryDelayMs,
      dustSweepEnabled: flat.dustSweepEnabled,
      dustSweepIntervalMin: flat.dustSweepIntervalMin,
      dustSweepMinUsd: flat.dustSweepMinUsd,
      dustSweepSlippageBps: flat.dustSweepSlippageBps,
    },
    strategy: {
      strategy: flat.strategy,
      minBinsBelow: flat.minBinsBelow,
      maxBinsBelow: flat.maxBinsBelow,
      defaultBinsBelow: flat.defaultBinsBelow,
    },
    schedule: {
      managementIntervalMin: flat.managementIntervalMin,
      screeningIntervalMin: flat.screeningIntervalMin,
      healthCheckIntervalMin: flat.healthCheckIntervalMin,
    },
    screening: {
      excludeHighSupplyConcentration: flat.excludeHighSupplyConcentration,
      minFeeActiveTvlRatio: flat.minFeeActiveTvlRatio,
      minTvl: flat.minTvl,
      maxTvl: flat.maxTvl,
      minVolume: flat.minVolume,
      minOrganic: flat.minOrganic,
      minQuoteOrganic: flat.minQuoteOrganic,
      minHolders: flat.minHolders,
      minMcap: flat.minMcap,
      maxMcap: flat.maxMcap,
      minBinStep: flat.minBinStep,
      maxBinStep: flat.maxBinStep,
      timeframe: flat.timeframe,
      category: flat.category,
      minTokenFeesSol: flat.minTokenFeesSol,
      useDiscordSignals: flat.useDiscordSignals,
      discordSignalMode: flat.discordSignalMode,
      avoidPvpSymbols: flat.avoidPvpSymbols,
      blockPvpSymbols: flat.blockPvpSymbols,
      maxBotHoldersPct: flat.maxBotHoldersPct,
      maxTop10Pct: flat.maxTop10Pct,
      allowedLaunchpads: flat.allowedLaunchpads,
      blockedLaunchpads: flat.blockedLaunchpads,
      minTokenAgeHours: flat.minTokenAgeHours,
      maxTokenAgeHours: flat.maxTokenAgeHours,
    },
    llm: {
      temperature: flat.temperature,
      maxTokens: flat.maxTokens,
      maxSteps: flat.maxSteps,
      managementModel: flat.managementModel,
      screeningModel: flat.screeningModel,
      generalModel: flat.generalModel,
    },
    darwin: {
      enabled: flat.darwinEnabled,
      windowDays: flat.darwinWindowDays,
      recalcEvery: flat.darwinRecalcEvery,
      boostFactor: flat.darwinBoost,
      decayFactor: flat.darwinDecay,
      weightFloor: flat.darwinFloor,
      weightCeiling: flat.darwinCeiling,
      minSamples: flat.darwinMinSamples,
    },
    hiveMind: {
      url: flat.hiveMindUrl,
      apiKey: flat.hiveMindApiKey,
      agentId: flat.agentId,
      pullMode: flat.hiveMindPullMode,
    },
    api: {
      url: flat.agentMeridianApiUrl,
      publicApiKey: flat.publicApiKey,
      lpAgentRelayEnabled: flat.lpAgentRelayEnabled,
    },
    jupiter: {
      apiKey: flat.jupiterApiKey,
      referralAccount: flat.jupiterReferralAccount,
      referralFeeBps: flat.jupiterReferralFeeBps,
    },
    indicators: {
      enabled: flat.chartIndicators.enabled,
      entryPreset: flat.chartIndicators.entryPreset,
      exitPreset: flat.chartIndicators.exitPreset,
      rsiLength: flat.chartIndicators.rsiLength,
      intervals: flat.chartIndicators.intervals,
      candles: flat.chartIndicators.candles,
      rsiOversold: flat.chartIndicators.rsiOversold,
      rsiOverbought: flat.chartIndicators.rsiOverbought,
      requireAllIntervals: flat.chartIndicators.requireAllIntervals,
    },
    tokens: {
      SOL: "So11111111111111111111111111111111111111112",
      USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    },
    pnl: {
      source: flat.pnlSource,
      rpcUrl: flat.pnlRpcUrl,
      pollIntervalSec: flat.pnlPollIntervalSec,
      depositCacheTtlSec: flat.pnlDepositCacheTtlSec,
    },
  };
}

/**
 * Full pipeline: raw JSON → validated flat → nested AppConfig → validated again.
 * Both validation stages surface Zod issues.
 */
export function parseAppConfig(raw: unknown): Result<AppConfig, ConfigLoadError> {
  const flat = FlatUserConfigSchema.safeParse(raw);
  if (!flat.success) return err({ kind: "flat_invalid", issues: flat.error.issues });
  const nested = AppConfigSchema.safeParse(flatToNested(flat.data));
  if (!nested.success) return err({ kind: "nested_invalid", issues: nested.error.issues });
  return ok(nested.data);
}

/**
 * Rebuild the flat file from a nested AppConfig — used by the migration script + `update_config` writeback.
 * Note: this drops keys we haven't ported yet (e.g. llm, screening); callers merge with the original flat.
 */
export function nestedToFlat(nested: AppConfig): Partial<FlatUserConfig> {
  return {
    ...nested.risk,
    ...nested.management,
    ...nested.strategy,
    ...nested.schedule,
    ...nested.screening,
    ...nested.llm,
    darwinEnabled: nested.darwin.enabled,
    darwinWindowDays: nested.darwin.windowDays,
    darwinRecalcEvery: nested.darwin.recalcEvery,
    darwinBoost: nested.darwin.boostFactor,
    darwinDecay: nested.darwin.decayFactor,
    darwinFloor: nested.darwin.weightFloor,
    darwinCeiling: nested.darwin.weightCeiling,
    darwinMinSamples: nested.darwin.minSamples,
    hiveMindUrl: nested.hiveMind.url,
    hiveMindApiKey: nested.hiveMind.apiKey,
    agentId: nested.hiveMind.agentId,
    hiveMindPullMode: nested.hiveMind.pullMode,
    agentMeridianApiUrl: nested.api.url,
    publicApiKey: nested.api.publicApiKey,
    lpAgentRelayEnabled: nested.api.lpAgentRelayEnabled,
    jupiterApiKey: nested.jupiter.apiKey,
    jupiterReferralAccount: nested.jupiter.referralAccount,
    jupiterReferralFeeBps: nested.jupiter.referralFeeBps,
    chartIndicators: {
      enabled: nested.indicators.enabled,
      entryPreset: nested.indicators.entryPreset,
      exitPreset: nested.indicators.exitPreset,
      rsiLength: nested.indicators.rsiLength,
      intervals: nested.indicators.intervals,
      candles: nested.indicators.candles,
      rsiOversold: nested.indicators.rsiOversold,
      rsiOverbought: nested.indicators.rsiOverbought,
      requireAllIntervals: nested.indicators.requireAllIntervals,
    },
    pnlSource: nested.pnl.source,
    pnlRpcUrl: nested.pnl.rpcUrl,
    pnlPollIntervalSec: nested.pnl.pollIntervalSec,
    pnlDepositCacheTtlSec: nested.pnl.depositCacheTtlSec,
  };
}
