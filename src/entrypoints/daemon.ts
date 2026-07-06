import path from "node:path";
import { fixedClock, systemClock } from "../ports/clock.js";
import { createConsoleLogger } from "../adapters/logger/console.js";
import { createJsonPositionRepo } from "../adapters/persistence/json/position-repo.js";
import { createJsonPoolMemoryRepo } from "../adapters/persistence/json/pool-memory-repo.js";
import { createJsonConfigRepo } from "../adapters/persistence/json/config-repo.js";
import { createJsonLessonRepo } from "../adapters/persistence/json/lesson-repo.js";
import { createJsonDecisionLog } from "../adapters/persistence/json/decision-log.js";
import { createJsonStrategyRepo } from "../adapters/persistence/json/strategy-repo.js";
import { createJsonSmartWalletRepo } from "../adapters/persistence/json/smart-wallet-repo.js";
import { createJsonTokenBlacklistRepo } from "../adapters/persistence/json/token-blacklist-repo.js";
import { createDryRunChainClient } from "../adapters/chain/dry-run.js";
import { createMeteoraChainClient } from "../adapters/chain/meteora/client.js";
import { createSolanaConnection, loadWalletKeypair } from "../adapters/chain/meteora/connection.js";
import { createStaticPriceOracle } from "../adapters/market/static-price-oracle.js";
import { createJupiterPriceOracle } from "../adapters/market/jupiter-price-oracle.js";
import { createJupiterSwapClient } from "../adapters/swap/jupiter-swap.js";
import { createMeteoraDatapiPnlFetcher } from "../adapters/chain/meteora/datapi-pnl.js";
import type { ChainClient } from "../ports/chain-client.js";
import type { PriceOracle } from "../ports/price-oracle.js";
import type { SwapClient } from "../ports/swap-client.js";
import { createOpenRouterLLMClient } from "../adapters/llm/openrouter.js";
import { createFakeLLM } from "../adapters/llm/fake.js";
import { createCollectingNotifier } from "../adapters/notify/collecting-notifier.js";
import { createTelegramNotifier } from "../adapters/notify/telegram.js";
import type { Notifier } from "../ports/notifier.js";
import { createFakePoolDiscovery } from "../adapters/market/fake-pool-discovery.js";
import { createFakeTokenInfo } from "../adapters/market/fake-token-info.js";
import { createFakeRugCheck } from "../adapters/market/fake-rug-check.js";
import { createFakeSmartWalletChecker } from "../adapters/market/fake-smart-wallet-checker.js";
import { createMeteoraPoolDiscovery } from "../adapters/market/meteora-pool-discovery.js";
import { createJupiterTokenInfo } from "../adapters/market/jupiter-token-info.js";
import { createRugcheckAdapter } from "../adapters/market/rugcheck.js";
import { createMeteoraSmartWalletChecker } from "../adapters/market/meteora-smart-wallet-checker.js";
import type { PoolDiscoveryClient } from "../ports/pool-discovery.js";
import type { TokenInfoClient } from "../ports/token-info-client.js";
import type { RugCheckClient } from "../ports/rug-check.js";
import type { SmartWalletChecker } from "../ports/smart-wallet-checker.js";
import { createRegistry } from "../app/tools/registry.js";
import { getPoolMemoryTool } from "../app/tools/impls/get-pool-memory.js";
import { assertPoolDeployableTool } from "../app/tools/impls/assert-pool-deployable.js";
import { getWalletBalanceTool } from "../app/tools/impls/get-wallet-balance.js";
import { getActiveBinTool } from "../app/tools/impls/get-active-bin.js";
import { getMyPositionsTool } from "../app/tools/impls/get-my-positions.js";
import { getRecentDecisionsTool } from "../app/tools/impls/get-recent-decisions.js";
import { listBlacklistTool } from "../app/tools/impls/list-blacklist.js";
import { listSmartWalletsTool } from "../app/tools/impls/list-smart-wallets.js";
import { getActiveStrategyTool } from "../app/tools/impls/get-active-strategy.js";
import { deployPositionTool } from "../app/tools/impls/deploy-position.js";
import { closePositionTool } from "../app/tools/impls/close-position.js";
import { claimFeesTool } from "../app/tools/impls/claim-fees.js";
import { swapTokenTool } from "../app/tools/impls/swap-token.js";
import { addToBlacklistTool } from "../app/tools/impls/add-to-blacklist.js";
import { searchPoolsTool } from "../app/tools/impls/search-pools.js";
import { getTokenInfoTool } from "../app/tools/impls/get-token-info.js";
import { getTokenHoldersTool } from "../app/tools/impls/get-token-holders.js";
import { getTokenNarrativeTool } from "../app/tools/impls/get-token-narrative.js";
import { checkSmartWalletsOnPoolTool } from "../app/tools/impls/check-smart-wallets-on-pool.js";
import { getTopCandidatesTool } from "../app/tools/impls/get-top-candidates.js";
import type { AppContext } from "../app/tools/context.js";
import type { LLMClient } from "../ports/llm-client.js";
import type { AppConfig } from "../domain/schemas/config.js";
import { createIntervalScheduler } from "../adapters/scheduler/interval.js";
import { runScreeningCycle } from "../app/screening/cycle.js";
import { runManagementCycle } from "../app/management/cycle.js";
import { createPnlPoller } from "../app/management/pnl-poller.js";
import { runBriefingCycle } from "../app/briefing/cycle.js";
import { runHealthCycle } from "../app/health/cycle.js";
import { createAgentMeridianHiveMind } from "../adapters/hivemind/agent-meridian.js";
import { createHiveMindSync } from "../app/hivemind/sync.js";
import { createTelegramInbound } from "../adapters/notify/telegram-inbound.js";
import { routeTelegramMessage } from "../app/telegram/router.js";

const REPO_ROOT = process.cwd();
const STATE_DIR = process.env.MERIDIAN_STATE_DIR
  ? path.resolve(process.env.MERIDIAN_STATE_DIR)
  : REPO_ROOT;

const ALL_TOOLS = [
  getPoolMemoryTool,
  assertPoolDeployableTool,
  getWalletBalanceTool,
  getActiveBinTool,
  getMyPositionsTool,
  getRecentDecisionsTool,
  listBlacklistTool,
  listSmartWalletsTool,
  getActiveStrategyTool,
  deployPositionTool,
  closePositionTool,
  claimFeesTool,
  swapTokenTool,
  addToBlacklistTool,
  searchPoolsTool,
  getTokenInfoTool,
  getTokenHoldersTool,
  getTokenNarrativeTool,
  checkSmartWalletsOnPoolTool,
  getTopCandidatesTool,
];

interface BootResult {
  config: AppConfig;
  ctx: AppContext;
  llm: LLMClient;
  usingDemoLLM: boolean;
}

async function boot(): Promise<BootResult> {
  const logger = createConsoleLogger("info");
  const clock = process.env.MERIDIAN_FROZEN_TIME
    ? fixedClock(process.env.MERIDIAN_FROZEN_TIME)
    : systemClock;

  const primaryConfigPath = path.join(REPO_ROOT, "user-config.json");
  const configRepo = createJsonConfigRepo({ filePath: primaryConfigPath });
  let cfg = await configRepo.load();
  if (!cfg.ok && cfg.error.kind === "load" && cfg.error.error.kind === "not_found") {
    const examplePath = path.join(REPO_ROOT, "user-config.example.json");
    logger.warn("boot", `user-config.json not found, falling back to ${examplePath}`);
    cfg = await createJsonConfigRepo({ filePath: examplePath }).load();
  }
  if (!cfg.ok) {
    throw new Error(
      `Failed to load user-config.json: ${cfg.error.kind}${
        cfg.error.kind === "load" ? ` (${cfg.error.error.kind})` : ""
      }`,
    );
  }

  const positions = createJsonPositionRepo({ filePath: path.join(STATE_DIR, "state.json"), clock, logger });
  const poolMemory = createJsonPoolMemoryRepo({ filePath: path.join(STATE_DIR, "pool-memory.json"), logger });
  const lessons = createJsonLessonRepo({ filePath: path.join(STATE_DIR, "lessons.json"), logger });
  const decisions = createJsonDecisionLog({ filePath: path.join(STATE_DIR, "decision-log.json"), logger });
  const strategies = createJsonStrategyRepo({ filePath: path.join(STATE_DIR, "strategy-library.json"), logger });
  const smartWallets = createJsonSmartWalletRepo({ filePath: path.join(STATE_DIR, "smart-wallets.json"), logger });
  const tokenBlacklist = createJsonTokenBlacklistRepo({ filePath: path.join(STATE_DIR, "token-blacklist.json"), logger });

  const chainMode = (process.env.MERIDIAN_CHAIN ?? "dryrun").toLowerCase();
  const priceMode = (
    process.env.MERIDIAN_PRICE ?? (chainMode === "meteora" ? "jupiter" : "static")
  ).toLowerCase();
  const staticPrice = Number(process.env.SOL_PRICE_USD ?? 150);

  function buildPriceOracle(): PriceOracle {
    if (priceMode === "jupiter") {
      return createJupiterPriceOracle({
        clock,
        logger,
        fallbackUsd: Number.isFinite(staticPrice) && staticPrice > 0 ? staticPrice : 150,
      });
    }
    if (priceMode !== "static") {
      throw new Error(`MERIDIAN_PRICE unknown: ${priceMode} (expected "jupiter" or "static")`);
    }
    return createStaticPriceOracle(staticPrice);
  }
  const price = buildPriceOracle();
  logger.info("boot", `price: ${priceMode}`);

  let chain: ChainClient;
  let swap: SwapClient;
  if (chainMode === "meteora") {
    const rpc = process.env.RPC_URL;
    const secret = process.env.WALLET_PRIVATE_KEY;
    if (!rpc) throw new Error("MERIDIAN_CHAIN=meteora requires RPC_URL");
    if (!secret) throw new Error("MERIDIAN_CHAIN=meteora requires WALLET_PRIVATE_KEY");
    const [connection, wallet] = await Promise.all([
      createSolanaConnection(rpc),
      loadWalletKeypair(secret),
    ]);
    const pnl = createMeteoraDatapiPnlFetcher({ logger });
    const writesEnabled = process.env.MERIDIAN_WRITE_UNSAFE === "true";
    if (writesEnabled) {
      logger.warn(
        "boot",
        "MERIDIAN_WRITE_UNSAFE=true — real Meteora write paths ARMED. Real SOL can move.",
      );
    }
    chain = createMeteoraChainClient({
      connection,
      wallet,
      price,
      clock,
      logger,
      pnl,
      solMode: cfg.value.management.solMode,
      pnlMaxDiffPct: cfg.value.management.pnlSanityMaxDiffPct,
      writesEnabled,
    });
    const referralAccount =
      process.env.JUPITER_REFERRAL_ACCOUNT ?? cfg.value.jupiter.referralAccount;
    const referralFeeBps = process.env.JUPITER_REFERRAL_FEE_BPS
      ? Number(process.env.JUPITER_REFERRAL_FEE_BPS)
      : cfg.value.jupiter.referralFeeBps;
    swap = createJupiterSwapClient({
      clock,
      logger,
      wallet,
      connection,
      ...(referralAccount ? { referralAccount } : {}),
      ...(referralFeeBps ? { referralFeeBps } : {}),
    });
    logger.info("boot", `chain: meteora (wallet=${wallet.address.slice(0, 8)}...)`);
  } else {
    chain = createDryRunChainClient({ clock, seed: { walletSol: 5 } });
    swap = {
      async swap(args: import("../domain/schemas/chain.js").SwapArgs) {
        return {
          success: true,
          input_mint: args.input_mint,
          output_mint: args.output_mint,
          amount_in: args.amount_in,
          amount_out: args.amount_in,
          tx: "daemon-fake-swap",
          dry_run: true,
        };
      },
    };
    logger.info("boot", "chain: dryrun");
  }
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
  const notifier: Notifier =
    telegramToken && telegramChatId
      ? createTelegramNotifier({ botToken: telegramToken, chatId: telegramChatId, logger })
      : createCollectingNotifier();
  logger.info("boot", `notifier: ${telegramToken && telegramChatId ? "telegram" : "collecting"}`);

  const marketMode = (
    process.env.MERIDIAN_MARKET ?? (chainMode === "meteora" ? "real" : "fake")
  ).toLowerCase();
  if (marketMode !== "real" && marketMode !== "fake") {
    throw new Error(`MERIDIAN_MARKET unknown: ${marketMode} (expected "real" or "fake")`);
  }
  const nowFn = (): Date => clock.now();
  const pools: PoolDiscoveryClient =
    marketMode === "real"
      ? createMeteoraPoolDiscovery({
          logger,
          screening: cfg.value.screening,
          now: nowFn,
        })
      : createFakePoolDiscovery({
          seed: [
            {
              pool_address: "DemoPool111111111111111111111111111111111111",
              name: "DEMO/SOL",
              base_mint: "DemoMint11111111111111111111111111111111111",
              quote_mint: "So11111111111111111111111111111111111111112",
              tvl: 50_000,
              active_tvl: 40_000,
              volume_window: 25_000,
              fee_active_tvl_ratio: 0.12,
              fee_tvl_ratio: 0.1,
              organic_score: 75,
              holders: 1200,
              mcap: 400_000,
              bin_step: 100,
              volatility: 0.08,
              launchpad: null,
              token_age_hours: 48,
              active_pct: 65,
            },
          ],
        });
  const tokenInfo: TokenInfoClient =
    marketMode === "real"
      ? createJupiterTokenInfo({ logger, now: nowFn })
      : createFakeTokenInfo();
  const rugCheck: RugCheckClient =
    marketMode === "real" ? createRugcheckAdapter({ logger }) : createFakeRugCheck();
  const smartWalletChecker: SmartWalletChecker =
    marketMode === "real"
      ? createMeteoraSmartWalletChecker({
          logger,
          clock,
          loadWallets: async () => {
            const list = await smartWallets.list();
            return list.map(({ addedAt: _drop, ...rest }) => ({
              ...rest,
              addedAt: _drop,
            }));
          },
          tokenInfo,
        })
      : createFakeSmartWalletChecker();
  const market = {
    pools,
    tokenInfo,
    rugCheck,
    smartWalletChecker,
  };
  logger.info("boot", `market: ${marketMode}`);

  const ctx: AppContext = {
    clock,
    logger,
    config: cfg.value,
    chain,
    swap,
    notifier,
    market,
    repos: { positions, poolMemory, lessons, decisions, strategies, smartWallets, tokenBlacklist },
  };

  const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.LLM_API_KEY;
  const useDemo = process.env.MERIDIAN_DEMO === "true" || !apiKey;
  const llm: LLMClient = useDemo
    ? createFakeLLM({
        script: [
          // Screener demo: full pipeline — top candidates → assert deployable → deploy → verify
          { kind: "tool_calls", calls: [{ name: "get_wallet_balance", args: {} }] },
          { kind: "tool_calls", calls: [{ name: "get_top_candidates", args: { limit: 3 } }] },
          { kind: "tool_calls", calls: [{ name: "assert_pool_deployable", args: { pool_address: "DemoPool111111111111111111111111111111111111", base_mint: "DemoMint11111111111111111111111111111111111" } }] },
          {
            kind: "tool_calls",
            calls: [
              {
                name: "deploy_position",
                args: {
                  pool_address: "DemoPool111111111111111111111111111111111111",
                  amount_sol: 0.5,
                  strategy: "bid_ask",
                  bins_below: 40,
                  bins_above: 10,
                  pool_name: "DEMO/SOL",
                  base_mint: "DemoMint11111111111111111111111111111111111",
                },
              },
            ],
          },
          { kind: "tool_calls", calls: [{ name: "get_my_positions", args: { force: true } }] },
          { kind: "assistant", text: "Screened 1 candidate, DEMO/SOL passed all filters. Deployed 0.5 SOL (bid_ask, 40 bins below)." },
        ],
        model: "demo/fake-v1",
      })
    : createOpenRouterLLMClient({
        apiKey,
        ...(process.env.LLM_BASE_URL ? { baseURL: process.env.LLM_BASE_URL } : {}),
      });

  return { config: cfg.value, ctx, llm, usingDemoLLM: useDemo };
}

async function main(): Promise<void> {
  const banner = "meridian-ts skeleton";
  const startedAt = new Date().toISOString();

  const boot0 = await boot().catch((e: unknown) => {
    console.error(`${banner}: boot failed:`, e);
    process.exit(1);
  });
  const { ctx, llm, usingDemoLLM } = boot0;

  console.log(`${banner} boot ok @ ${startedAt}`);
  console.log(`  llm: ${usingDemoLLM ? "fake (demo)" : "openrouter"}`);
  console.log(`  max positions: ${ctx.config.risk.maxPositions}`);
  console.log(`  strategy: ${ctx.config.strategy.strategy} bins=${ctx.config.strategy.defaultBinsBelow}`);

  const walletAtBoot = await ctx.chain.getWalletBalance();
  console.log(`  wallet: ${walletAtBoot.sol} SOL ($${walletAtBoot.sol_usd})`);

  const registry = createRegistry(ALL_TOOLS);
  const model = process.env.LLM_MODEL ?? "demo/fake-v1";

  if (process.env.MERIDIAN_AUTONOMOUS === "true") {
    console.log(`\n──── AUTONOMOUS mode ────`);
    const scheduler = createIntervalScheduler(ctx.logger);
    const screenMs = ctx.config.schedule.screeningIntervalMin * 60_000;
    const manageMs = ctx.config.schedule.managementIntervalMin * 60_000;
    console.log(`  screening every ${screenMs / 1000}s | management every ${manageMs / 1000}s`);
    scheduler.every(screenMs, () => runScreeningCycle({ ctx, llm, registry, model }).then(() => {}), "screening");
    scheduler.every(manageMs, () => runManagementCycle({ ctx, llm, registry, model }).then(() => {}), "management");
    const pollerHandle = createPnlPoller({
      clock: ctx.clock,
      logger: ctx.logger,
      chain: ctx.chain,
      notifier: ctx.notifier,
      scheduler,
      positionRepo: ctx.repos.positions,
      config: ctx.config.management,
    });
    console.log("  pnl-poller: 30s trailing-TP + 15s two-phase confirm");

    const healthMs = ctx.config.schedule.healthCheckIntervalMin * 60_000;
    scheduler.every(
      healthMs,
      () =>
        runHealthCycle({ ctx, llm, registry, model }).then(() => {}).catch((err: unknown) => {
          ctx.logger.warn("health", "cycle failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }),
      "health",
    );
    console.log(`  health-check: every ${healthMs / 1000}s`);

    const briefingIntervalMs = 24 * 3_600_000;
    scheduler.every(
      briefingIntervalMs,
      () =>
        runBriefingCycle({ ctx }).then(() => {}).catch((err: unknown) => {
          ctx.logger.warn("briefing", "cycle failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }),
      "briefing",
    );
    console.log("  briefing: every 24h");

    const hive = createAgentMeridianHiveMind({
      logger: ctx.logger,
      clock: ctx.clock,
      enabled: !!ctx.config.hiveMind.agentId && ctx.config.hiveMind.pullMode !== "manual",
      agentId: ctx.config.hiveMind.agentId,
      ...(ctx.config.hiveMind.apiKey ? { apiKey: ctx.config.hiveMind.apiKey } : {}),
      baseUrl: ctx.config.hiveMind.url,
      version: "meridian-ts",
      capabilities: () => ({
        chain: process.env.MERIDIAN_CHAIN ?? "dryrun",
        market: process.env.MERIDIAN_MARKET ?? "fake",
        writes_armed: process.env.MERIDIAN_WRITE_UNSAFE === "true",
        dry_run: process.env.DRY_RUN === "true",
      }),
    });
    const hiveSync = createHiveMindSync({
      clock: ctx.clock,
      logger: ctx.logger,
      scheduler,
      client: hive,
    });
    if (hive.isEnabled()) {
      console.log("  hivemind-sync: every 15m (agent-meridian)");
    } else {
      console.log("  hivemind-sync: disabled (no agentId or manual pull mode)");
    }
    const shutdownHive = hiveSync.stop;

    let shutdownInbound: () => void = () => {};
    let shuttingDown = false;
    const shutdown = (sig: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\n${sig} — shutting down scheduler`);
      pollerHandle.stop();
      shutdownHive();
      shutdownInbound();
      scheduler.cancelAll();
      process.exit(0);
    };
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;
    const telegramAllowed = (process.env.TELEGRAM_ALLOWED_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (telegramToken && telegramChatId) {
      const inbound = createTelegramInbound({
        logger: ctx.logger,
        botToken: telegramToken,
        chatId: telegramChatId,
        allowedUserIds: telegramAllowed,
      });
      const handle = inbound.start(async (msg) => {
        try {
          await routeTelegramMessage(
            { ctx, llm, registry, model, scheduler, shutdown },
            msg,
          );
        } catch (err) {
          ctx.logger.warn("telegram-router", "route threw", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
      shutdownInbound = handle.stop;
      console.log("  telegram-inbound: long-poll REPL armed");
    } else {
      console.log("  telegram-inbound: disabled (no TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)");
    }
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    console.log("(Ctrl+C to stop)");
    return;
  }

  // One-shot mode — run one screening cycle for demo.
  const outcome = await runScreeningCycle({ ctx, llm, registry, model });
  console.log("\n─── screening cycle ───");
  console.log(`outcome: ${outcome.kind}`);
  if (outcome.kind === "invoked") {
    const { agent } = outcome;
    console.log(`agent finish: ${agent.finishReason}  steps: ${agent.steps}  locks: [${agent.locks.join(", ")}]`);
    for (const t of agent.toolCalls) {
      console.log(`  · step ${t.step + 1}: ${t.name} ok=${t.ok}`);
    }
    console.log(`text: ${agent.text}`);
  } else if (outcome.kind === "no_deploy") {
    console.log(`  rejection_summary: ${outcome.rejection_summary.join(", ")}`);
  } else if (outcome.kind === "skipped") {
    console.log(`  reason: ${outcome.reason}`);
  }
  const collecting = ctx.notifier as unknown as { recorded?: unknown[] };
  console.log(`notifier recorded: ${collecting.recorded?.length ?? 0} events`);
  const afterDecisions = await ctx.repos.decisions.recent(3);
  console.log(`decision log entries: ${afterDecisions.length}`);
}

main().catch((e: unknown) => {
  console.error("fatal:", e);
  process.exit(1);
});
