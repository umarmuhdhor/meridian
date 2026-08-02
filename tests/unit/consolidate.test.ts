import { describe, it, expect } from "vitest";
import {
  consolidateBaseToSol,
  WRAPPED_SOL_MINT,
  DEFAULT_CONSOLIDATE_SLIPPAGE_BPS,
  DEFAULT_CONSOLIDATE_MIN_USD,
  type ConsolidateDeps,
} from "../../src/app/management/consolidate.js";
import { createCollectingNotifier } from "../../src/adapters/notify/collecting-notifier.js";
import { nullLogger } from "../../src/ports/logger.js";
import type { ChainClient } from "../../src/ports/chain-client.js";
import type { SwapClient } from "../../src/ports/swap-client.js";
import type { SwapArgs, WalletToken } from "../../src/domain/schemas/chain.js";

const BASE_MINT = "BaSeMiNtxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

function chainWithTokens(tokens: WalletToken[], opts: { throws?: boolean } = {}): ChainClient {
  return {
    async getWalletTokens() {
      if (opts.throws) throw new Error("rpc down");
      return tokens;
    },
    // Everything else is unused by the helper.
  } as unknown as ChainClient;
}

function recordingSwap(): { swap: SwapClient; calls: SwapArgs[] } {
  const calls: SwapArgs[] = [];
  const swap: SwapClient = {
    async swap(args) {
      calls.push(args);
      return {
        success: true,
        input_mint: args.input_mint,
        output_mint: args.output_mint,
        amount_in: args.amount_in,
        amount_out: args.amount_in,
        tx: "swap-tx",
        dry_run: false,
      };
    },
  };
  return { swap, calls };
}

function makeDeps(chain: ChainClient, swap: SwapClient): ConsolidateDeps & { notifier: ReturnType<typeof createCollectingNotifier> } {
  // retries=1 + no-op sleep keeps existing single-shot tests fast; retry-loop
  // tests override these explicitly.
  return {
    chain,
    swap,
    notifier: createCollectingNotifier(),
    logger: nullLogger,
    retries: 1,
    sleep: async () => {},
  };
}

describe("consolidateBaseToSol", () => {
  it("swaps the FULL raw base balance to SOL with the default consolidation slippage", async () => {
    const { swap, calls } = recordingSwap();
    const chain = chainWithTokens([
      { mint: BASE_MINT, symbol: null, balance: 1000, raw: "1000000000", usd: 42 },
    ]);
    const deps = makeDeps(chain, swap);

    const result = await consolidateBaseToSol(deps, BASE_MINT);

    expect(result?.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      input_mint: BASE_MINT,
      output_mint: WRAPPED_SOL_MINT,
      amount_in_raw: "1000000000", // raw, NOT the uiAmount 1000
      slippage_bps: DEFAULT_CONSOLIDATE_SLIPPAGE_BPS,
    });
    // Swap card fired.
    expect(deps.notifier.recorded.some((r) => r.type === "swap")).toBe(true);
  });

  it("honors caller-provided slippage + dust threshold from config", async () => {
    const { swap, calls } = recordingSwap();
    const chain = chainWithTokens([
      { mint: BASE_MINT, symbol: null, balance: 1000, raw: "1000000000", usd: 42 },
    ]);
    const deps = { ...makeDeps(chain, swap), slippageBps: 250, minUsd: 1.0 };
    await consolidateBaseToSol(deps, BASE_MINT);
    expect(calls[0]?.slippage_bps).toBe(250);
  });

  it("preserves full precision for a raw amount above 2^53 (BigInt string end-to-end)", async () => {
    const { swap, calls } = recordingSwap();
    // 9_007_199_254_740_993 = 2^53 + 1 — not exactly representable as a JS number.
    const huge = "9007199254740993";
    const chain = chainWithTokens([
      { mint: BASE_MINT, symbol: null, balance: 9_007_199_254.74, raw: huge, usd: 42 },
    ]);
    await consolidateBaseToSol(makeDeps(chain, swap), BASE_MINT);
    expect(calls[0]?.amount_in_raw).toBe(huge); // exact, no rounding
    expect(BigInt(calls[0]!.amount_in_raw!)).toBe(9_007_199_254_740_993n);
  });

  it("no-ops when the base token is already SOL", async () => {
    const { swap, calls } = recordingSwap();
    const deps = makeDeps(chainWithTokens([]), swap);
    const result = await consolidateBaseToSol(deps, WRAPPED_SOL_MINT);
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("no-ops when baseMint is null", async () => {
    const { swap, calls } = recordingSwap();
    const deps = makeDeps(chainWithTokens([]), swap);
    expect(await consolidateBaseToSol(deps, null)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("is idempotent — skips when no balance is held (e.g. close didn't land / already sold)", async () => {
    const { swap, calls } = recordingSwap();
    const deps = makeDeps(chainWithTokens([]), swap);
    const result = await consolidateBaseToSol(deps, BASE_MINT);
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("skips priced dust below the USD threshold", async () => {
    const { swap, calls } = recordingSwap();
    const chain = chainWithTokens([
      { mint: BASE_MINT, symbol: null, balance: 5, raw: "5", usd: DEFAULT_CONSOLIDATE_MIN_USD - 0.01 },
    ]);
    const result = await consolidateBaseToSol(makeDeps(chain, swap), BASE_MINT);
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("still swaps an UNPRICED holding (usd null) — likely the just-withdrawn base", async () => {
    const { swap, calls } = recordingSwap();
    const chain = chainWithTokens([
      { mint: BASE_MINT, symbol: null, balance: 5, raw: "5", usd: null },
    ]);
    const result = await consolidateBaseToSol(makeDeps(chain, swap), BASE_MINT);
    expect(result?.success).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("never throws when getWalletTokens fails — returns null", async () => {
    const { swap, calls } = recordingSwap();
    const chain = chainWithTokens([], { throws: true });
    const result = await consolidateBaseToSol(makeDeps(chain, swap), BASE_MINT);
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("retries when the wallet ATA balance isn't visible yet (RPC race)", async () => {
    let call = 0;
    const chain: ChainClient = {
      async getWalletTokens() {
        call += 1;
        if (call < 3) return []; // first two reads: RPC lag → empty
        return [{ mint: BASE_MINT, symbol: null, balance: 1000, raw: "1000000000", usd: 42 }];
      },
    } as unknown as ChainClient;
    const { swap, calls } = recordingSwap();
    const sleepCalls: number[] = [];
    const deps: ConsolidateDeps & { notifier: ReturnType<typeof createCollectingNotifier> } = {
      chain,
      swap,
      notifier: createCollectingNotifier(),
      logger: nullLogger,
      retries: 5,
      retryDelayMs: 10,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    };
    const result = await consolidateBaseToSol(deps, BASE_MINT);
    expect(result?.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(call).toBe(3); // stopped as soon as balance appeared
    expect(sleepCalls).toEqual([10, 10]);
  });

  it("gives up cleanly after exhausting retries — logs but never throws", async () => {
    const chain = chainWithTokens([]); // always empty
    const { swap, calls } = recordingSwap();
    const deps: ConsolidateDeps & { notifier: ReturnType<typeof createCollectingNotifier> } = {
      chain,
      swap,
      notifier: createCollectingNotifier(),
      logger: nullLogger,
      retries: 3,
      retryDelayMs: 5,
      sleep: async () => {},
    };
    const result = await consolidateBaseToSol(deps, BASE_MINT);
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("never throws when the swap itself throws — returns null", async () => {
    const chain = chainWithTokens([
      { mint: BASE_MINT, symbol: null, balance: 1000, raw: "1000000000", usd: 42 },
    ]);
    const swap: SwapClient = {
      async swap() {
        throw new Error("jupiter 500");
      },
    };
    const result = await consolidateBaseToSol(makeDeps(chain, swap), BASE_MINT);
    expect(result).toBeNull();
  });
});
