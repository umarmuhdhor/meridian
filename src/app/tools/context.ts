import type { Clock } from "../../ports/clock.js";
import type { Logger } from "../../ports/logger.js";
import type { PositionRepo } from "../../ports/position-repo.js";
import type { PoolMemoryRepo } from "../../ports/pool-memory-repo.js";
import type { LessonRepo } from "../../ports/lesson-repo.js";
import type { DecisionLogRepo } from "../../ports/decision-log.js";
import type { StrategyRepo } from "../../ports/strategy-repo.js";
import type { SmartWalletRepo } from "../../ports/smart-wallet-repo.js";
import type { TokenBlacklistRepo } from "../../ports/token-blacklist-repo.js";
import type { ChainClient } from "../../ports/chain-client.js";
import type { SwapClient } from "../../ports/swap-client.js";
import type { Notifier } from "../../ports/notifier.js";
import type { PoolDiscoveryClient } from "../../ports/pool-discovery.js";
import type { TokenInfoClient } from "../../ports/token-info-client.js";
import type { RugCheckClient } from "../../ports/rug-check.js";
import type { SmartWalletChecker } from "../../ports/smart-wallet-checker.js";
import type { AppConfig } from "../../domain/schemas/config.js";

/**
 * Everything a tool needs to execute. Assembled once at daemon boot and passed by reference
 * through the ReAct loop. Ports only — no concrete impls.
 */
export interface AppContext {
  clock: Clock;
  logger: Logger;
  config: AppConfig;
  chain: ChainClient;
  swap: SwapClient;
  notifier: Notifier;
  market: {
    pools: PoolDiscoveryClient;
    tokenInfo: TokenInfoClient;
    rugCheck: RugCheckClient;
    smartWalletChecker: SmartWalletChecker;
  };
  repos: {
    positions: PositionRepo;
    poolMemory: PoolMemoryRepo;
    lessons: LessonRepo;
    decisions: DecisionLogRepo;
    strategies: StrategyRepo;
    smartWallets: SmartWalletRepo;
    tokenBlacklist: TokenBlacklistRepo;
  };
}
