import { describe, it, expect, vi } from "vitest";
import type { Clock } from "../../src/ports/clock.js";
import { nullLogger } from "../../src/ports/logger.js";
import type { ChainClient } from "../../src/ports/chain-client.js";
import type { SwapClient } from "../../src/ports/swap-client.js";
import type { SwapArgs } from "../../src/domain/schemas/chain.js";
import type { Notifier } from "../../src/ports/notifier.js";
import type { PositionRepo } from "../../src/ports/position-repo.js";
import type { ManagementConfig } from "../../src/domain/schemas/config.js";
import type {
  OnChainPosition,
  PositionsSnapshot,
} from "../../src/domain/schemas/chain.js";
import type { TrackedPosition } from "../../src/domain/schemas/position.js";
import {
  createPnlPoller,
  tickPnlPoller,
} from "../../src/app/management/pnl-poller.js";
import { createManualScheduler } from "../../src/adapters/scheduler/manual.js";

function mutableClock(startIso: string): Clock & { advance(ms: number): void } {
  let ms = new Date(startIso).getTime();
  return {
    now: () => new Date(ms),
    advance: (delta: number) => {
      ms += delta;
    },
  };
}

const mgmt: ManagementConfig = {
  stopLossPct: -50,
  stopLossGraceMinutes: 30,
  takeProfitPct: 5,
  outOfRangeWaitMinutes: 30,
  minFeePerTvl24h: 7,
  minAgeBeforeYieldCheck: 60,
  minClaimAmount: 5,
  trailingTakeProfit: true,
  trailingTriggerPct: 3,
  trailingDropPct: 1.5,
  deployAmountSol: 0.5,
  gasReserve: 0.2,
  positionSizePct: 0.35,
  pnlSanityMaxDiffPct: 5,
  solMode: false,
  autoSwapSlippageBps: 250,
  autoSwapMinUsd: 0.5,
  consolidateRetries: 1,
  consolidateRetryDelayMs: 0,
  dustSweepEnabled: false,
  dustSweepIntervalMin: 5,
  dustSweepMinUsd: 0.01,
  dustSweepSlippageBps: 500,
};

function makeLive(overrides: Partial<OnChainPosition & { _peakPnlPct: number }> = {}): OnChainPosition {
  return {
    position: "Pos1",
    pool: "PoolA",
    pair: "MEME/SOL",
    base_mint: "MintA",
    lower_bin: -20,
    upper_bin: 20,
    active_bin: 0,
    in_range: true,
    unclaimed_fees_usd: 0,
    pnl_pct: 8,
    pnl_pct_suspicious: false,
    total_value_usd: 100,
    fee_per_tvl_24h: 10,
    age_minutes: 120,
    ...overrides,
  };
}

function snap(...positions: OnChainPosition[]): PositionsSnapshot {
  return {
    total_positions: positions.length,
    positions,
    wallet: "W",
    fetched_at: "2026-07-05T12:00:00.000Z",
  };
}

describe("tickPnlPoller — pure", () => {
  it("queues (does not fire) on first-seen trailing drop", () => {
    const nowMs = 1_000_000;
    const now = new Date(nowMs);
    const live = makeLive({ pnl_pct: 7 });
    (live as OnChainPosition & { _peakPnlPct: number })._peakPnlPct = 10; // dropped 3 ≥ 1.5
    const { next, actions } = tickPnlPoller([], snap(live), now, mgmt, {
      confirmDelayMs: 15_000,
      confirmTolerancePct: 1,
    });
    expect(actions).toHaveLength(0);
    expect(next).toHaveLength(1);
    expect(next[0]?.positionAddress).toBe("Pos1");
    expect(next[0]?.peakPnlPct).toBe(10);
    expect(next[0]?.atQueueTime).toBe(7);
    expect(next[0]?.queuedAtMs).toBe(nowMs);
  });

  it("does not queue when peak is below trigger", () => {
    const live = makeLive({ pnl_pct: 1 });
    (live as OnChainPosition & { _peakPnlPct: number })._peakPnlPct = 2; // < trailingTriggerPct 3
    const { next } = tickPnlPoller([], snap(live), new Date(0), mgmt, {
      confirmDelayMs: 15_000,
      confirmTolerancePct: 1,
    });
    expect(next).toHaveLength(0);
  });

  it("does not queue when drop is below trailingDropPct", () => {
    const live = makeLive({ pnl_pct: 9 });
    (live as OnChainPosition & { _peakPnlPct: number })._peakPnlPct = 10; // drop 1 < 1.5
    const { next } = tickPnlPoller([], snap(live), new Date(0), mgmt, {
      confirmDelayMs: 15_000,
      confirmTolerancePct: 1,
    });
    expect(next).toHaveLength(0);
  });

  it("keeps pending until confirmDelayMs elapses", () => {
    const nowMs = 1_000_000;
    const pending = [
      {
        positionAddress: "Pos1",
        peakPnlPct: 10,
        atQueueTime: 7,
        queuedAtMs: nowMs - 5_000,
        reason: "old",
      },
    ];
    const live = makeLive({ pnl_pct: 7 });
    (live as OnChainPosition & { _peakPnlPct: number })._peakPnlPct = 10;
    const { next, actions } = tickPnlPoller(pending, snap(live), new Date(nowMs), mgmt, {
      confirmDelayMs: 15_000,
      confirmTolerancePct: 1,
    });
    expect(actions).toHaveLength(0);
    expect(next).toHaveLength(1); // still pending
  });

  it("fires close_confirmed when drop still holds after delay", () => {
    const queuedAtMs = 1_000_000;
    const nowMs = queuedAtMs + 20_000; // past 15s window
    const pending = [
      { positionAddress: "Pos1", peakPnlPct: 10, atQueueTime: 7, queuedAtMs, reason: "trailing" },
    ];
    const live = makeLive({ pnl_pct: 6.5 }); // now dropped further
    (live as OnChainPosition & { _peakPnlPct: number })._peakPnlPct = 10;
    const { next, actions } = tickPnlPoller(pending, snap(live), new Date(nowMs), mgmt, {
      confirmDelayMs: 15_000,
      confirmTolerancePct: 1,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe("close_confirmed");
    expect(actions[0]?.positionAddress).toBe("Pos1");
    expect(actions[0]?.reason).toBe("trailing");
    expect(next).toHaveLength(0);
  });

  it("drops pending when price recovers past tolerance", () => {
    const queuedAtMs = 1_000_000;
    const nowMs = queuedAtMs + 20_000;
    const pending = [
      { positionAddress: "Pos1", peakPnlPct: 10, atQueueTime: 7, queuedAtMs, reason: "trailing" },
    ];
    // Recovered to 9 (drop 1, was 3 at queue → recovery 2 > tolerance 1)
    const live = makeLive({ pnl_pct: 9 });
    (live as OnChainPosition & { _peakPnlPct: number })._peakPnlPct = 10;
    const { next, actions } = tickPnlPoller(pending, snap(live), new Date(nowMs), mgmt, {
      confirmDelayMs: 15_000,
      confirmTolerancePct: 1,
    });
    expect(actions).toHaveLength(0);
    expect(next).toHaveLength(0);
  });

  it("skips positions with suspect PnL — never fires or queues", () => {
    const live = makeLive({ pnl_pct: null, pnl_pct_suspicious: true });
    (live as OnChainPosition & { _peakPnlPct: number })._peakPnlPct = 10;
    const { next, actions } = tickPnlPoller([], snap(live), new Date(0), mgmt, {
      confirmDelayMs: 15_000,
      confirmTolerancePct: 1,
    });
    expect(actions).toHaveLength(0);
    expect(next).toHaveLength(0);
  });

  it("drops pending when position vanishes from snapshot", () => {
    const queuedAtMs = 1_000_000;
    const nowMs = queuedAtMs + 20_000;
    const pending = [
      { positionAddress: "GonePos", peakPnlPct: 10, atQueueTime: 7, queuedAtMs, reason: "x" },
    ];
    const { next, actions } = tickPnlPoller(pending, snap(), new Date(nowMs), mgmt, {
      confirmDelayMs: 15_000,
      confirmTolerancePct: 1,
    });
    expect(actions).toHaveLength(0);
    expect(next).toHaveLength(0);
  });
});

describe("createPnlPoller — orchestration", () => {
  function fakeChain(
    snapshot: PositionsSnapshot,
    closeSpy: ReturnType<typeof vi.fn>,
    walletTokens: { mint: string; symbol: string | null; balance: number; raw?: string; usd: number | null }[] = [],
  ): ChainClient {
    return {
      async getWalletBalance() {
        throw new Error("nope");
      },
      async getActiveBin() {
        throw new Error("nope");
      },
      async getMyPositions() {
        return snapshot;
      },
      async getWalletTokens() {
        return walletTokens;
      },
      async deployPosition() {
        throw new Error("nope");
      },
      closePosition: closeSpy as unknown as ChainClient["closePosition"],
      async claimFees() {
        throw new Error("nope");
      },
    };
  }

  function fakeSwap(): SwapClient & { calls: SwapArgs[] } {
    const calls: SwapArgs[] = [];
    return {
      calls,
      async swap(args) {
        calls.push(args);
        return {
          success: true,
          input_mint: args.input_mint,
          output_mint: args.output_mint,
          amount_in: args.amount_in,
          amount_out: args.amount_in,
          tx: "swap-sig",
          dry_run: false,
        };
      },
    };
  }

  function fakePositionRepo(tracked: Record<string, TrackedPosition>): PositionRepo {
    return {
      async load() {
        throw new Error("nope");
      },
      async save() {},
      async get(addr: string) {
        return tracked[addr] ?? null;
      },
      async all() {
        return Object.values(tracked);
      },
      async upsert() {},
      async pushEvent() {},
    };
  }

  function fakeNotifier(): Notifier & { closes: unknown[] } {
    const closes: unknown[] = [];
    return {
      async notify() {},
      async notifyDeploy() {},
      async notifyClose(r) {
        closes.push(r);
      },
      async notifyClaim() {},
      async notifySwap() {},
      async notifyOutOfRange() {},
      async startLive() {
        return {
          toolStart: async () => {},
          toolFinish: async () => {},
          note: async () => {},
          finalize: async () => {},
          fail: async () => {},
        };
      },
      closes,
    };
  }

  it("fires close_confirmed after a trailing drop persists across two ticks", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const scheduler = createManualScheduler(clock.now().getTime());
    let currentSnap = snap(makeLive({ pnl_pct: 7 })); // peak-drop already
    const tracked: TrackedPosition = {
      position: "Pos1",
      pool: "PoolA",
      pool_name: "MEME/SOL",
      strategy: "bid_ask",
      bin_range: { min: -20, max: 20 },
      amount_sol: 0.5,
      active_bin_at_deploy: 0,
      deployed_at: "2026-07-05T10:00:00.000Z",
      peak_pnl_pct: 10,
      trailing_active: true,
    };
    const closeSpy = vi.fn(async () => ({
      success: true,
      position_address: "Pos1",
      pool_address: "PoolA",
      base_mint: "MintA",
      final_pnl_pct: 7,
      final_value_usd: 100,
      fees_earned_usd: 2,
      reason: "trailing",
      tx: "SIG_1",
      dry_run: false,
    }));
    const notifier = fakeNotifier();
    const swap = fakeSwap();
    const poller = createPnlPoller({
      clock,
      logger: nullLogger,
      chain: fakeChain(currentSnap, closeSpy, [
        { mint: "MintA", symbol: null, balance: 1000, raw: "1000000000", usd: 50 },
      ]),
      swap,
      notifier,
      scheduler,
      positionRepo: fakePositionRepo({ Pos1: tracked }),
      config: mgmt,
      pollIntervalMs: 30_000,
      confirmDelayMs: 15_000,
      confirmTolerancePct: 1,
    });

    // First tick — queues, does not fire.
    await scheduler.advance(30_000);
    clock.advance(30_000);
    expect(closeSpy).not.toHaveBeenCalled();
    expect(poller.peekPending()).toHaveLength(1);

    // Second tick 30s later — past 15s confirm window; drop still holds → fires.
    await scheduler.advance(30_000);
    clock.advance(30_000);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy.mock.calls[0]![0]).toBe("Pos1");
    expect(notifier.closes).toHaveLength(1);
    expect(poller.peekPending()).toHaveLength(0);

    // Auto-swap: the withdrawn base (MintA) is consolidated to SOL after the close,
    // at the exact raw amount and the config-driven slippage (mgmt.autoSwapSlippageBps).
    expect(swap.calls).toHaveLength(1);
    expect(swap.calls[0]).toMatchObject({
      input_mint: "MintA",
      output_mint: "So11111111111111111111111111111111111111112",
      amount_in_raw: "1000000000",
      slippage_bps: 250,
    });

    poller.stop();
  });

  it("swallows close errors (e.g. writes not armed) without stopping the poller", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const scheduler = createManualScheduler(clock.now().getTime());
    const currentSnap = snap(makeLive({ pnl_pct: 7 }));
    const tracked: TrackedPosition = {
      position: "Pos1",
      pool: "PoolA",
      pool_name: "MEME/SOL",
      strategy: "bid_ask",
      bin_range: { min: -20, max: 20 },
      amount_sol: 0.5,
      active_bin_at_deploy: 0,
      deployed_at: "2026-07-05T10:00:00.000Z",
      peak_pnl_pct: 10,
      trailing_active: true,
    };
    const closeSpy = vi.fn(async () => {
      throw new Error("writes not armed");
    });
    const notifier = fakeNotifier();
    const poller = createPnlPoller({
      clock,
      logger: nullLogger,
      chain: fakeChain(currentSnap, closeSpy),
      swap: fakeSwap(),
      notifier,
      scheduler,
      positionRepo: fakePositionRepo({ Pos1: tracked }),
      config: mgmt,
      pollIntervalMs: 30_000,
      confirmDelayMs: 15_000,
      confirmTolerancePct: 1,
    });
    await scheduler.advance(30_000);
    clock.advance(30_000);
    await scheduler.advance(30_000);
    clock.advance(30_000);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(notifier.closes).toHaveLength(0);
    expect(poller.peekPending()).toHaveLength(0);
    poller.stop();
  });
});
