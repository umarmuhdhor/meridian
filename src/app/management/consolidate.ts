import type { ChainClient } from "../../ports/chain-client.js";
import type { SwapClient } from "../../ports/swap-client.js";
import type { Notifier } from "../../ports/notifier.js";
import type { Logger } from "../../ports/logger.js";
import type { SwapResult } from "../../domain/schemas/chain.js";

/** Canonical wrapped-SOL mint. Universal, so consolidation doesn't need config.tokens. */
export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

/** Fallback slippage (bps) when a caller doesn't pass one. Exited memecoins are thin. */
export const DEFAULT_CONSOLIDATE_SLIPPAGE_BPS = 300;

/** Fallback dust floor (USD) when a caller doesn't pass one. */
export const DEFAULT_CONSOLIDATE_MIN_USD = 0.5;

export interface ConsolidateDeps {
  chain: ChainClient;
  swap: SwapClient;
  notifier: Notifier;
  logger: Logger;
  /** Slippage (bps) for the swap. Defaults to {@link DEFAULT_CONSOLIDATE_SLIPPAGE_BPS}. */
  slippageBps?: number;
  /** Skip base balances priced below this USD value. Defaults to {@link DEFAULT_CONSOLIDATE_MIN_USD}. */
  minUsd?: number;
}

/**
 * Deterministically sell a just-closed position's base token back to SOL.
 *
 * A Meteora DLMM close withdraws BOTH bin tokens (base + SOL) to the wallet — the base
 * side just sits there as an SPL balance unless something sells it. This is that
 * "something": read the live wallet balance for `baseMint` and swap all of it to SOL.
 *
 * Deliberately **idempotent + never-throws**:
 *   - reads the live on-chain balance, so a mint at ~0 is skipped (safe to call for a
 *     close that didn't actually land, or twice for the same close).
 *   - any failure (no wallet-token reader, fetch error, swap error) is logged and
 *     returns `null` — it must never break the close path that invoked it.
 *
 * Amount is carried as a RAW base-unit integer string end-to-end (`amount_in_raw`) and
 * converted to BigInt in the swap adapter, so large-supply / low-decimal tokens never
 * lose precision through a JS `number`.
 */
export async function consolidateBaseToSol(
  deps: ConsolidateDeps,
  baseMint: string | null,
): Promise<SwapResult | null> {
  if (!baseMint || baseMint === WRAPPED_SOL_MINT) return null; // nothing to do / already SOL
  if (!deps.chain.getWalletTokens) {
    deps.logger.info("consolidate", "chain has no getWalletTokens — skipping", { baseMint });
    return null;
  }

  let held;
  try {
    const tokens = await deps.chain.getWalletTokens();
    held = tokens.find((t) => t.mint === baseMint);
  } catch (err) {
    deps.logger.warn("consolidate", "getWalletTokens failed — skipping", {
      baseMint,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const rawStr = held?.raw ?? "0";
  let rawAmount: bigint;
  try {
    rawAmount = BigInt(rawStr);
  } catch {
    rawAmount = 0n;
  }
  if (!held || rawAmount <= 0n) {
    deps.logger.info("consolidate", "no base balance to consolidate", { baseMint });
    return null;
  }

  const minUsd = deps.minUsd ?? DEFAULT_CONSOLIDATE_MIN_USD;
  if (held.usd != null && held.usd < minUsd) {
    deps.logger.info("consolidate", "base balance below dust threshold — skipping", {
      baseMint,
      usd: held.usd,
      minUsd,
    });
    return null;
  }

  try {
    const result = await deps.swap.swap({
      input_mint: baseMint,
      output_mint: WRAPPED_SOL_MINT,
      // amount_in_raw is authoritative (BigInt-exact); amount_in is a best-effort numeric
      // echo for adapters/tests that only read the number field.
      amount_in: Number(rawAmount),
      amount_in_raw: rawStr,
      slippage_bps: deps.slippageBps ?? DEFAULT_CONSOLIDATE_SLIPPAGE_BPS,
    });
    if (result.success) {
      deps.logger.info("consolidate", "consolidated base → SOL", {
        baseMint,
        amount_in_raw: rawStr,
        amount_out: result.amount_out,
        tx: result.tx,
      });
      try {
        await deps.notifier.notifySwap(result);
      } catch {
        // notify is best-effort — never fail the consolidation on a notifier error.
      }
    } else {
      deps.logger.warn("consolidate", "swap returned failure", { baseMint });
    }
    return result;
  } catch (err) {
    deps.logger.warn("consolidate", "swap threw — skipping", {
      baseMint,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
