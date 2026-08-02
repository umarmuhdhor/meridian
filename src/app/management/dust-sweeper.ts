import type { Clock } from "../../ports/clock.js";
import type { Logger } from "../../ports/logger.js";
import type { ChainClient } from "../../ports/chain-client.js";
import type { SwapClient } from "../../ports/swap-client.js";
import type { Notifier } from "../../ports/notifier.js";
import type { Scheduler } from "../../ports/scheduler.js";
import type { WalletToken } from "../../domain/schemas/chain.js";
import { WRAPPED_SOL_MINT } from "./consolidate.js";

const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60_000;
/**
 * Absolute floor for sweeping. Kept intentionally near-zero so nearly every
 * non-SOL token gets sold — the user's rule is "always sell". Lower than the
 * per-close consolidate floor because the sweeper runs asynchronously and
 * doesn't block anything, so trying and failing on a $0.02 dust bag is cheap.
 * A hard 0 would attempt swaps on rounding-error residuals no aggregator can
 * route, wasting RPC and log noise — this floor sidesteps that.
 */
const DEFAULT_SWEEP_MIN_USD = 0.01;
const DEFAULT_SWEEP_SLIPPAGE_BPS = 500;

export interface DustSweeperDeps {
  clock: Clock;
  logger: Logger;
  chain: ChainClient;
  swap: SwapClient;
  notifier: Notifier;
  scheduler: Scheduler;
  intervalMs?: number;
  minUsd?: number;
  slippageBps?: number;
}

export interface DustSweeperHandle {
  stop(): void;
  /** Run a sweep immediately. Exposed for tests + telegram /sweep. */
  runOnce(): Promise<void>;
}

/**
 * Periodic wallet sweep: sell every non-SOL token that isn't currently held
 * by an open Meteora position. Second safety net behind per-close
 * `consolidateBaseToSol` — catches leftovers from:
 *   - close/consolidate races the RPC lag survives
 *   - manual closes done outside the app
 *   - restarts that abort consolidate mid-flight
 *   - anything else that leaves an SPL balance in the wallet
 *
 * Never throws. Serialises via a busy flag so a slow swap batch can't stack
 * ticks. Excludes the base mints of currently-open positions so we never
 * sell what's still deployed.
 */
export function createDustSweeper(deps: DustSweeperDeps): DustSweeperHandle {
  const intervalMs = deps.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const minUsd = deps.minUsd ?? DEFAULT_SWEEP_MIN_USD;
  const slippageBps = deps.slippageBps ?? DEFAULT_SWEEP_SLIPPAGE_BPS;
  let busy = false;

  async function tick(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await runOnce();
    } catch (err) {
      deps.logger.warn("dust-sweeper", "tick failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      busy = false;
    }
  }

  async function runOnce(): Promise<void> {
    if (!deps.chain.getWalletTokens) {
      deps.logger.info("dust-sweeper", "chain has no getWalletTokens — skipping");
      return;
    }
    let tokens: WalletToken[];
    try {
      tokens = await deps.chain.getWalletTokens();
    } catch (err) {
      deps.logger.warn("dust-sweeper", "getWalletTokens failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (tokens.length === 0) return;

    // Don't sell what's currently deployed — a base mint held by an open
    // position is legitimate inventory, not orphaned dust.
    const openMints = new Set<string>();
    try {
      const snap = await deps.chain.getMyPositions();
      for (const p of snap.positions) if (p.base_mint) openMints.add(p.base_mint);
    } catch (err) {
      deps.logger.warn("dust-sweeper", "getMyPositions failed — sweeping without exclusions", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const targets = tokens.filter((t) => {
      if (t.mint === WRAPPED_SOL_MINT) return false;
      if (openMints.has(t.mint)) return false;
      let raw = 0n;
      try {
        raw = BigInt(t.raw ?? "0");
      } catch {
        raw = 0n;
      }
      if (raw <= 0n) return false;
      // usd=null = unpriced. Sweep anyway — better to try and fail cleanly
      // than leave an unpriced bag sitting forever.
      if (t.usd != null && t.usd < minUsd) return false;
      return true;
    });

    if (targets.length === 0) return;
    deps.logger.info("dust-sweeper", "sweeping wallet tokens", {
      count: targets.length,
      mints: targets.map((t) => t.mint),
    });

    for (const t of targets) {
      try {
        const result = await deps.swap.swap({
          input_mint: t.mint,
          output_mint: WRAPPED_SOL_MINT,
          amount_in: Number(BigInt(t.raw ?? "0")),
          amount_in_raw: t.raw ?? "0",
          slippage_bps: slippageBps,
        });
        if (result.success) {
          deps.logger.info("dust-sweeper", "swept token → SOL", {
            mint: t.mint,
            amount_in_raw: t.raw,
            amount_out: result.amount_out,
            tx: result.tx,
          });
          try {
            await deps.notifier.notifySwap(result);
          } catch {
            // notify best-effort
          }
        } else {
          deps.logger.warn("dust-sweeper", "swap returned failure", { mint: t.mint });
        }
      } catch (err) {
        deps.logger.warn("dust-sweeper", "swap threw — leaving mint for next tick", {
          mint: t.mint,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const handle = deps.scheduler.every(intervalMs, tick, "dust-sweeper");
  return {
    stop: () => handle.cancel(),
    runOnce,
  };
}
