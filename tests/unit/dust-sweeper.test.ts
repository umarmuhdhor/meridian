import { describe, it, expect } from "vitest";
import { createDustSweeper } from "../../src/app/management/dust-sweeper.js";
import { WRAPPED_SOL_MINT } from "../../src/app/management/consolidate.js";
import { createManualScheduler } from "../../src/adapters/scheduler/manual.js";
import { createCollectingNotifier } from "../../src/adapters/notify/collecting-notifier.js";
import { nullLogger } from "../../src/ports/logger.js";
import type { ChainClient } from "../../src/ports/chain-client.js";
import type { SwapClient } from "../../src/ports/swap-client.js";
import type { SwapArgs, WalletToken, OnChainPosition } from "../../src/domain/schemas/chain.js";

const OPEN_MINT = "OpEnHeLdxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const DUST_A = "DuStAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DUST_B = "DuStBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DUST_UNPRICED = "UnPrIcEdxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const NANO = "NanODusTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

function fakeChain(tokens: WalletToken[], positions: OnChainPosition[] = []): ChainClient {
  return {
    async getWalletTokens() {
      return tokens;
    },
    async getMyPositions() {
      return {
        total_positions: positions.length,
        positions,
        fetched_at: new Date().toISOString(),
      };
    },
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
        tx: `tx-${calls.length}`,
        dry_run: false,
      };
    },
  };
  return { swap, calls };
}

describe("createDustSweeper", () => {
  it("sweeps every non-SOL wallet token above the dust floor", async () => {
    const chain = fakeChain([
      { mint: WRAPPED_SOL_MINT, symbol: "SOL", balance: 5, raw: "5000000000", usd: 500 },
      { mint: DUST_A, symbol: null, balance: 100, raw: "100", usd: 10 },
      { mint: DUST_B, symbol: null, balance: 200, raw: "200", usd: 5 },
    ]);
    const { swap, calls } = recordingSwap();
    const sweeper = createDustSweeper({
      clock: { now: () => new Date() },
      logger: nullLogger,
      chain,
      swap,
      notifier: createCollectingNotifier(),
      scheduler: createManualScheduler(),
      minUsd: 0.01,
    });
    await sweeper.runOnce();
    expect(calls.map((c) => c.input_mint).sort()).toEqual([DUST_A, DUST_B].sort());
    expect(calls.every((c) => c.output_mint === WRAPPED_SOL_MINT)).toBe(true);
  });

  it("never sells a mint that's currently held by an open position", async () => {
    const chain = fakeChain(
      [
        { mint: OPEN_MINT, symbol: null, balance: 1_000, raw: "1000000", usd: 42 },
        { mint: DUST_A, symbol: null, balance: 50, raw: "50", usd: 5 },
      ],
      [
        {
          position: "pos1",
          pool: "pool1",
          pair: "OPEN/SOL",
          base_mint: OPEN_MINT,
          lower_bin: -10,
          upper_bin: 10,
          active_bin: 0,
          in_range: true,
          unclaimed_fees_usd: 0,
          pnl_pct: 0,
          pnl_pct_suspicious: false,
        },
      ],
    );
    const { swap, calls } = recordingSwap();
    const sweeper = createDustSweeper({
      clock: { now: () => new Date() },
      logger: nullLogger,
      chain,
      swap,
      notifier: createCollectingNotifier(),
      scheduler: createManualScheduler(),
      minUsd: 0.01,
    });
    await sweeper.runOnce();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input_mint).toBe(DUST_A);
  });

  it("sweeps unpriced tokens (usd=null) — 'always sell' the withdrawn base", async () => {
    const chain = fakeChain([
      { mint: DUST_UNPRICED, symbol: null, balance: 999, raw: "999", usd: null },
    ]);
    const { swap, calls } = recordingSwap();
    const sweeper = createDustSweeper({
      clock: { now: () => new Date() },
      logger: nullLogger,
      chain,
      swap,
      notifier: createCollectingNotifier(),
      scheduler: createManualScheduler(),
    });
    await sweeper.runOnce();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input_mint).toBe(DUST_UNPRICED);
  });

  it("skips only the priced-nano dust below the configured floor", async () => {
    const chain = fakeChain([
      { mint: NANO, symbol: null, balance: 1, raw: "1", usd: 0.001 },
      { mint: DUST_A, symbol: null, balance: 5, raw: "5", usd: 5 },
    ]);
    const { swap, calls } = recordingSwap();
    const sweeper = createDustSweeper({
      clock: { now: () => new Date() },
      logger: nullLogger,
      chain,
      swap,
      notifier: createCollectingNotifier(),
      scheduler: createManualScheduler(),
      minUsd: 0.01,
    });
    await sweeper.runOnce();
    expect(calls.map((c) => c.input_mint)).toEqual([DUST_A]);
  });

  it("never throws when a single swap fails — continues sweeping the rest", async () => {
    const chain = fakeChain([
      { mint: DUST_A, symbol: null, balance: 5, raw: "5", usd: 5 },
      { mint: DUST_B, symbol: null, balance: 5, raw: "5", usd: 5 },
    ]);
    const swap: SwapClient = {
      async swap(args) {
        if (args.input_mint === DUST_A) throw new Error("jupiter 500");
        return {
          success: true,
          input_mint: args.input_mint,
          output_mint: args.output_mint,
          amount_in: args.amount_in,
          amount_out: args.amount_in,
          tx: "tx-b",
          dry_run: false,
        };
      },
    };
    const sweeper = createDustSweeper({
      clock: { now: () => new Date() },
      logger: nullLogger,
      chain,
      swap,
      notifier: createCollectingNotifier(),
      scheduler: createManualScheduler(),
      minUsd: 0.01,
    });
    await expect(sweeper.runOnce()).resolves.toBeUndefined();
  });

  it("scheduler tick invokes the sweeper", async () => {
    const chain = fakeChain([{ mint: DUST_A, symbol: null, balance: 5, raw: "5", usd: 5 }]);
    const { swap, calls } = recordingSwap();
    const scheduler = createManualScheduler();
    createDustSweeper({
      clock: { now: () => new Date() },
      logger: nullLogger,
      chain,
      swap,
      notifier: createCollectingNotifier(),
      scheduler,
      intervalMs: 1000,
      minUsd: 0.01,
    });
    await scheduler.advance(1000);
    expect(calls).toHaveLength(1);
  });
});
