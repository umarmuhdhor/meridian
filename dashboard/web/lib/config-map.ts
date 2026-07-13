// MIRROR of tools/executor.js update_config CONFIG_MAP. Secret keys
// (hiveMindApiKey, gmgnApiKey, publicApiKey) are read-only + redacted server-side.
// Indicator keys read from user-config.chartIndicators.* (nested); everything else flat.
//
// `unit`   — magnitude/currency shown next to the field so "800" reads as "$800" not "$800k".
// `help`   — hover tooltip explaining the field.
// `options`— renders a <select> (enum fields; values MUST match the Zod schema or saves reject).

export type ConfigType = "number" | "boolean" | "string" | "array";

export interface ConfigField {
  key: string;
  group: string;
  type: ConfigType;
  secret?: boolean;
  readPath?: string[]; // where to read the current value in user-config.json (default [key])
  unit?: string; // e.g. "USD", "SOL", "%", "hours", "bins"
  help?: string; // hover tooltip
  options?: readonly string[]; // enum → dropdown
}

const f = (key: string, type: ConfigType, group: string, extra: Partial<ConfigField> = {}): ConfigField => ({
  key,
  type,
  group,
  ...extra,
});

const ci = (key: string, type: ConfigType, field: string, extra: Partial<ConfigField> = {}): ConfigField =>
  f(key, type, "indicators", { readPath: ["chartIndicators", field], ...extra });

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
  f("minFeeActiveTvlRatio", "number", "screening", { unit: "ratio", help: "Min fee ÷ active-TVL. 0.12 = fees must be ≥ 12% of active TVL." }),
  f("excludeHighSupplyConcentration", "boolean", "screening", { help: "Reject tokens the datapi flags as high supply concentration." }),
  f("minTvl", "number", "screening", { unit: "USD", help: "Min pool TVL, in raw dollars (20000 = $20,000)." }),
  f("maxTvl", "number", "screening", { unit: "USD", help: "Max pool TVL, in dollars (250000 = $250,000)." }),
  f("minVolume", "number", "screening", { unit: "USD", help: "Min trading volume over `timeframe`, in dollars (800 = $800)." }),
  f("minOrganic", "number", "screening", { unit: "score 0–100", help: "Min base-token organic score (datapi, 0–100)." }),
  f("minQuoteOrganic", "number", "screening", { unit: "score 0–100", help: "Min quote-token organic score (0–100)." }),
  f("minHolders", "number", "screening", { unit: "count", help: "Min number of base-token holders." }),
  f("minMcap", "number", "screening", { unit: "USD", help: "Min market cap, in dollars (700000 = $700k)." }),
  f("maxMcap", "number", "screening", { unit: "USD", help: "Max market cap, in dollars (15000000 = $15M)." }),
  f("minBinStep", "number", "screening", { unit: "bins", help: "Min DLMM bin step (price granularity; discrete, e.g. 20/50/80/100/125)." }),
  f("maxBinStep", "number", "screening", { unit: "bins", help: "Max DLMM bin step." }),
  f("timeframe", "string", "screening", { options: ["5m", "1h", "6h", "24h"], help: "Datapi stats window used for volume/fee metrics." }),
  f("category", "string", "screening", { help: "Datapi pool category filter (e.g. trending)." }),
  f("minTokenFeesSol", "number", "screening", { unit: "SOL", help: "Min lifetime token fees generated, in SOL." }),
  f("useDiscordSignals", "boolean", "screening", { help: "Use Discord alpha signals as candidates. HIGH-RISK per the signal provider." }),
  f("discordSignalMode", "string", "screening", { options: ["merge", "only"], help: "merge = Discord signals + normal screening; only = Discord signals alone." }),
  f("avoidPvpSymbols", "boolean", "screening", { help: "Down-rank PvP / competitive-launch symbols." }),
  f("blockPvpSymbols", "boolean", "screening", { help: "Hard-reject PvP symbols entirely." }),
  f("maxBotHoldersPct", "number", "screening", { unit: "%", help: "Max % of holders flagged as bots (0–100)." }),
  f("maxTop10Pct", "number", "screening", { unit: "%", help: "Max % of supply held by the top-10 wallets (0–100)." }),
  f("allowedLaunchpads", "array", "screening", { unit: "list", help: "Comma-separated launchpads to allow. Empty = allow all." }),
  f("blockedLaunchpads", "array", "screening", { unit: "list", help: "Comma-separated launchpads to reject (e.g. letsbonk.fun)." }),
  f("minTokenAgeHours", "number", "screening", { unit: "hours", help: "Min token age in hours. Blank = no floor." }),
  f("maxTokenAgeHours", "number", "screening", { unit: "hours", help: "Max token age in hours. Blank = no ceiling." }),
  f("minFeePerTvl24h", "number", "screening", { unit: "ratio", help: "Min 24h fee/TVL before a position is closed as low-yield." }),
  f("loneCandidateMinDegen", "number", "screening", { unit: "score", help: "Min degen score to deploy when only one candidate passes." }),

  // ── management ──
  f("minClaimAmount", "number", "management", { unit: "USD", help: "Claim fees once unclaimed fees ≥ this, in dollars." }),
  f("autoSwapAfterClaim", "boolean", "management", { help: "Swap the claimed token → SOL right after claiming." }),
  f("autoSwapRetryAttempts", "number", "management", { unit: "count", help: "How many times to retry a failed auto-swap." }),
  f("autoSwapRetryDelayMs", "number", "management", { unit: "ms", help: "Delay between auto-swap retries, in milliseconds." }),
  f("outOfRangeBinsToClose", "number", "management", { unit: "bins", help: "Close when the active bin is this many bins past the position's range." }),
  f("outOfRangeWaitMinutes", "number", "management", { unit: "minutes", help: "How long a position may sit out-of-range before closing." }),
  f("oorCooldownTriggerCount", "number", "management", { unit: "count", help: "OOR closes within the window before the pool goes on cooldown." }),
  f("oorCooldownHours", "number", "management", { unit: "hours", help: "Cooldown duration after repeated out-of-range closes." }),
  f("repeatDeployCooldownEnabled", "boolean", "management", { help: "Cool down pools/tokens that were recently redeployed." }),
  f("repeatDeployCooldownTriggerCount", "number", "management", { unit: "count", help: "Redeploys before the cooldown kicks in." }),
  f("repeatDeployCooldownHours", "number", "management", { unit: "hours", help: "Repeat-deploy cooldown duration." }),
  f("repeatDeployCooldownScope", "string", "management", { options: ["token", "pool", "pool_and_token"], help: "What the repeat-deploy cooldown applies to." }),
  f("repeatDeployCooldownMinFeeEarnedPct", "number", "management", { unit: "%", help: "Skip the cooldown if the prior position earned at least this fee %." }),
  f("minVolumeToRebalance", "number", "management", { unit: "USD", help: "Min pool volume, in dollars, before a rebalance is allowed." }),
  f("stopLossPct", "number", "management", { unit: "%", help: "Close at this PnL loss. Negative, e.g. -50 = -50%." }),
  f("takeProfitPct", "number", "management", { unit: "%", help: "Close at this PnL gain, e.g. 5 = +5%." }),
  f("trailingTakeProfit", "boolean", "management", { help: "Enable trailing take-profit." }),
  f("trailingTriggerPct", "number", "management", { unit: "%", help: "Arm the trailing stop once peak PnL reaches this %." }),
  f("trailingDropPct", "number", "management", { unit: "%", help: "Close if PnL drops this % from its peak (after arming)." }),
  f("pnlSanityMaxDiffPct", "number", "management", { unit: "%", help: "Max allowed divergence between reported vs derived PnL before it's flagged suspect." }),
  f("solMode", "boolean", "management", { help: "Denominate PnL/sizing in SOL rather than USD." }),
  f("minSolToOpen", "number", "management", { unit: "SOL", help: "Min wallet SOL required to open a new position." }),
  f("deployAmountSol", "number", "management", { unit: "SOL", help: "SOL deployed per position." }),
  f("gasReserve", "number", "management", { unit: "SOL", help: "SOL kept unspent for transaction fees." }),
  f("positionSizePct", "number", "management", { unit: "fraction 0–1", help: "Fraction of wallet per position. 0.35 = 35%." }),
  f("minAgeBeforeYieldCheck", "number", "management", { unit: "minutes", help: "Position age before the low-yield rule can close it." }),
  f("pnlConfirmTicks", "number", "management", { unit: "count", help: "Consecutive poller ticks required to confirm a PnL-based close." }),

  // ── opportunity + degen ──
  f("opportunityPollEnabled", "boolean", "opportunity", { help: "Enable the opportunity poller." }),
  f("opportunityPollIntervalSec", "number", "opportunity", { unit: "sec", help: "Opportunity poll interval, in seconds." }),
  f("opportunityPollLimit", "number", "opportunity", { unit: "count", help: "Max opportunities pulled per poll." }),
  f("opportunityMinScore", "number", "opportunity", { unit: "score", help: "Min opportunity score to consider." }),
  f("opportunitySmartWalletBonus", "number", "opportunity", { unit: "score", help: "Score bonus when smart wallets are in the pool." }),
  f("degenTargetVolRatio", "number", "opportunity", { unit: "ratio", help: "Target volume ratio for degen scoring." }),
  f("degenTargetLpCount", "number", "opportunity", { unit: "count", help: "Target LP count for degen scoring." }),
  f("degenTargetFeeRatio", "number", "opportunity", { unit: "ratio", help: "Target fee ratio for degen scoring." }),
  f("degenTargetLiquidity", "number", "opportunity", { unit: "USD", help: "Target liquidity, in dollars, for degen scoring." }),

  // ── risk ──
  f("maxPositions", "number", "risk", { unit: "count", help: "Max concurrent open positions the agent will hold." }),
  f("maxDeployAmount", "number", "risk", { unit: "SOL", help: "Hard cap on SOL deployed in a single position." }),

  // ── schedule (interval changes restart cron) ──
  f("managementIntervalMin", "number", "schedule", { unit: "minutes", help: "How often the management cycle runs. Changing this restarts the cron." }),
  f("screeningIntervalMin", "number", "schedule", { unit: "minutes", help: "How often the screener runs. Changing this restarts the cron." }),
  f("healthCheckIntervalMin", "number", "schedule", { unit: "minutes", help: "Health-check interval. Changing this restarts the cron." }),

  // ── llm ──
  f("managementModel", "string", "llm", { unit: "model slug", help: "OpenRouter model for the manager, e.g. minimax/minimax-m2.7. Must be an exact slug." }),
  f("screeningModel", "string", "llm", { unit: "model slug", help: "OpenRouter model for the screener. Must be an exact slug." }),
  f("generalModel", "string", "llm", { unit: "model slug", help: "OpenRouter model for chat / Telegram. Must be an exact slug." }),
  f("temperature", "number", "llm", { unit: "0–2", help: "LLM sampling temperature." }),
  f("maxTokens", "number", "llm", { unit: "tokens", help: "Max completion tokens per LLM call." }),
  f("maxSteps", "number", "llm", { unit: "count", help: "Max ReAct steps per agent loop." }),

  // ── strategy (binsBelow* clamp ≥ 35) ──
  f("strategy", "string", "strategy", { options: ["spot", "curve", "bid_ask"], help: "Liquidity shape. spot = uniform, curve = concentrated, bid_ask = edges." }),
  f("minBinsBelow", "number", "strategy", { unit: "bins", help: "Min bins below the active bin (hard floor 35)." }),
  f("maxBinsBelow", "number", "strategy", { unit: "bins", help: "Max bins below the active bin." }),
  f("defaultBinsBelow", "number", "strategy", { unit: "bins", help: "Default bins below the active bin." }),

  // ── pnl fetcher/poller ──
  f("pnlSource", "string", "pnl", { options: ["rpc", "meteora"], help: "Where PnL is fetched from. rpc = Helius, meteora = datapi." }),
  f("pnlRpcUrl", "string", "pnl", { unit: "url", help: "RPC endpoint for PnL when source = rpc." }),
  f("pnlPollIntervalSec", "number", "pnl", { unit: "sec", help: "PnL poll interval, in seconds." }),
  f("pnlDepositCacheTtlSec", "number", "pnl", { unit: "sec", help: "TTL for the deposit cache, in seconds." }),

  // ── hiveMind ──
  f("hiveMindUrl", "string", "hiveMind", { unit: "url", help: "Agent Meridian HiveMind base URL. Empty breaks hivemind-sync." }),
  f("hiveMindApiKey", "string", "hiveMind", { secret: true, help: "HiveMind API key. Set via server; shown redacted here." }),
  f("agentId", "string", "hiveMind", { unit: "id", help: "This agent's HiveMind id." }),
  f("hiveMindPullMode", "string", "hiveMind", { options: ["auto", "manual"], help: "auto = sync every 15m; manual = only on demand." }),

  // ── api / relay ──
  f("publicApiKey", "string", "api", { secret: true, help: "Study-top-lpers / lpagent API key. Set via server; shown redacted." }),
  f("agentMeridianApiUrl", "string", "api", { unit: "url", help: "Agent Meridian API base URL (study top LPers)." }),
  f("lpAgentRelayEnabled", "boolean", "api", { help: "Relay position PnL to the LP agent." }),

  // ── gmgn ──
  f("gmgnFeeSource", "string", "gmgn", { help: "Fee data source for GMGN enrichment." }),
  f("gmgnApiKey", "string", "gmgn", { secret: true, help: "GMGN API key. Set via server; shown redacted." }),

  // ── indicators (nested chartIndicators.*) ──
  ci("chartIndicatorsEnabled", "boolean", "enabled", { help: "Enable RSI / indicator gating on entries & exits." }),
  ci("indicatorEntryPreset", "string", "entryPreset", { help: "Named entry indicator preset." }),
  ci("indicatorExitPreset", "string", "exitPreset", { help: "Named exit indicator preset." }),
  ci("rsiLength", "number", "rsiLength", { unit: "count", help: "RSI lookback length (candles)." }),
  ci("indicatorIntervals", "array", "intervals", { unit: "list", help: "Comma-separated candle intervals, e.g. 5m, 15m, 1h." }),
  ci("indicatorCandles", "number", "candles", { unit: "count", help: "How many candles to fetch per interval." }),
  ci("rsiOversold", "number", "rsiOversold", { unit: "0–100", help: "RSI oversold threshold." }),
  ci("rsiOverbought", "number", "rsiOverbought", { unit: "0–100", help: "RSI overbought threshold." }),
  ci("requireAllIntervals", "boolean", "requireAllIntervals", { help: "Require every interval to agree before acting." }),
];
