// MIRROR of tools/executor.js:345-461 (update_config CONFIG_MAP), verified 2026-07-03.
// The two pure aliases are intentionally omitted to avoid duplicate fields:
//   binsBelow      → maxBinsBelow  (same target)
//   takeProfitFeePct → takeProfitPct (same target)
// Secret keys (hiveMindApiKey, gmgnApiKey, publicApiKey) are read-only + redacted.
// Indicator keys read their current value from user-config.chartIndicators.* (nested);
// every other key reads flat from user-config[key].

export type ConfigType = "number" | "boolean" | "string" | "array";

export interface ConfigField {
  key: string;
  group: string;
  type: ConfigType;
  secret?: boolean;
  readPath?: string[]; // where to read the current value in user-config.json (default [key])
}

const f = (key: string, type: ConfigType, group: string, extra: Partial<ConfigField> = {}): ConfigField => ({
  key,
  type,
  group,
  ...extra,
});

const ci = (key: string, type: ConfigType, field: string): ConfigField =>
  f(key, type, "indicators", { readPath: ["chartIndicators", field] });

export const CONFIG_GROUPS = [
  "screening",
  "management",
  "opportunity",
  "risk",
  "schedule",
  "llm",
  "strategy",
  "pnl",
  "hiveMind",
  "api",
  "gmgn",
  "indicators",
] as const;

export const CONFIG_FIELDS: ConfigField[] = [
  // ── screening ──
  f("minFeeActiveTvlRatio", "number", "screening"),
  f("excludeHighSupplyConcentration", "boolean", "screening"),
  f("minTvl", "number", "screening"),
  f("maxTvl", "number", "screening"),
  f("minVolume", "number", "screening"),
  f("minOrganic", "number", "screening"),
  f("minQuoteOrganic", "number", "screening"),
  f("minHolders", "number", "screening"),
  f("minMcap", "number", "screening"),
  f("maxMcap", "number", "screening"),
  f("minBinStep", "number", "screening"),
  f("maxBinStep", "number", "screening"),
  f("timeframe", "string", "screening"),
  f("category", "string", "screening"),
  f("minTokenFeesSol", "number", "screening"),
  f("useDiscordSignals", "boolean", "screening"),
  f("discordSignalMode", "string", "screening"),
  f("avoidPvpSymbols", "boolean", "screening"),
  f("blockPvpSymbols", "boolean", "screening"),
  f("maxBotHoldersPct", "number", "screening"),
  f("maxTop10Pct", "number", "screening"),
  f("allowedLaunchpads", "array", "screening"),
  f("blockedLaunchpads", "array", "screening"),
  f("minTokenAgeHours", "number", "screening"),
  f("maxTokenAgeHours", "number", "screening"),
  f("minFeePerTvl24h", "number", "screening"),
  f("loneCandidateMinDegen", "number", "screening"),

  // ── management ──
  f("minClaimAmount", "number", "management"),
  f("autoSwapAfterClaim", "boolean", "management"),
  f("autoSwapRetryAttempts", "number", "management"),
  f("autoSwapRetryDelayMs", "number", "management"),
  f("outOfRangeBinsToClose", "number", "management"),
  f("outOfRangeWaitMinutes", "number", "management"),
  f("oorCooldownTriggerCount", "number", "management"),
  f("oorCooldownHours", "number", "management"),
  f("repeatDeployCooldownEnabled", "boolean", "management"),
  f("repeatDeployCooldownTriggerCount", "number", "management"),
  f("repeatDeployCooldownHours", "number", "management"),
  f("repeatDeployCooldownScope", "string", "management"),
  f("repeatDeployCooldownMinFeeEarnedPct", "number", "management"),
  f("minVolumeToRebalance", "number", "management"),
  f("stopLossPct", "number", "management"),
  f("takeProfitPct", "number", "management"),
  f("trailingTakeProfit", "boolean", "management"),
  f("trailingTriggerPct", "number", "management"),
  f("trailingDropPct", "number", "management"),
  f("pnlSanityMaxDiffPct", "number", "management"),
  f("solMode", "boolean", "management"),
  f("minSolToOpen", "number", "management"),
  f("deployAmountSol", "number", "management"),
  f("gasReserve", "number", "management"),
  f("positionSizePct", "number", "management"),
  f("minAgeBeforeYieldCheck", "number", "management"),
  f("pnlConfirmTicks", "number", "management"),

  // ── opportunity + degen ──
  f("opportunityPollEnabled", "boolean", "opportunity"),
  f("opportunityPollIntervalSec", "number", "opportunity"),
  f("opportunityPollLimit", "number", "opportunity"),
  f("opportunityMinScore", "number", "opportunity"),
  f("opportunitySmartWalletBonus", "number", "opportunity"),
  f("degenTargetVolRatio", "number", "opportunity"),
  f("degenTargetLpCount", "number", "opportunity"),
  f("degenTargetFeeRatio", "number", "opportunity"),
  f("degenTargetLiquidity", "number", "opportunity"),

  // ── risk ──
  f("maxPositions", "number", "risk"),
  f("maxDeployAmount", "number", "risk"),

  // ── schedule (interval changes restart cron) ──
  f("managementIntervalMin", "number", "schedule"),
  f("screeningIntervalMin", "number", "schedule"),
  f("healthCheckIntervalMin", "number", "schedule"),

  // ── llm ──
  f("managementModel", "string", "llm"),
  f("screeningModel", "string", "llm"),
  f("generalModel", "string", "llm"),
  f("temperature", "number", "llm"),
  f("maxTokens", "number", "llm"),
  f("maxSteps", "number", "llm"),

  // ── strategy (binsBelow* clamp ≥ 35) ──
  f("strategy", "string", "strategy"),
  f("minBinsBelow", "number", "strategy"),
  f("maxBinsBelow", "number", "strategy"),
  f("defaultBinsBelow", "number", "strategy"),

  // ── pnl fetcher/poller ──
  f("pnlSource", "string", "pnl"),
  f("pnlRpcUrl", "string", "pnl"),
  f("pnlPollIntervalSec", "number", "pnl"),
  f("pnlDepositCacheTtlSec", "number", "pnl"),

  // ── hiveMind ──
  f("hiveMindUrl", "string", "hiveMind"),
  f("hiveMindApiKey", "string", "hiveMind", { secret: true }),
  f("agentId", "string", "hiveMind"),
  f("hiveMindPullMode", "string", "hiveMind"),

  // ── api / relay ──
  f("publicApiKey", "string", "api", { secret: true }),
  f("agentMeridianApiUrl", "string", "api"),
  f("lpAgentRelayEnabled", "boolean", "api"),

  // ── gmgn ──
  f("gmgnFeeSource", "string", "gmgn"),
  f("gmgnApiKey", "string", "gmgn", { secret: true }),

  // ── indicators (nested chartIndicators.*) ──
  ci("chartIndicatorsEnabled", "boolean", "enabled"),
  ci("indicatorEntryPreset", "string", "entryPreset"),
  ci("indicatorExitPreset", "string", "exitPreset"),
  ci("rsiLength", "number", "rsiLength"),
  ci("indicatorIntervals", "array", "intervals"),
  ci("indicatorCandles", "number", "candles"),
  ci("rsiOversold", "number", "rsiOversold"),
  ci("rsiOverbought", "number", "rsiOverbought"),
  ci("requireAllIntervals", "boolean", "requireAllIntervals"),
];
