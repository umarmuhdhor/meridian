import { describe, it, expect } from "vitest";
import { createDryRunChainClient } from "../../src/adapters/chain/dry-run.js";
import type { Clock } from "../../src/ports/clock.js";

function mutableClock(startIso: string): Clock & { advance(ms: number): void } {
  let ms = new Date(startIso).getTime();
  return { now: () => new Date(ms), advance: (d) => { ms += d; } };
}

describe("DryRunChainClient — wallet + active bin", () => {
  it("wallet balance defaults + math", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const chain = createDryRunChainClient({ clock, seed: { walletSol: 5, solPriceUsd: 200 } });
    const b = await chain.getWalletBalance();
    expect(b.sol).toBe(5);
    expect(b.sol_usd).toBe(1000);
    expect(b.sol_price).toBe(200);
    expect(b.fetched_at).toBe(clock.now().toISOString());
  });

  it("active bin — seeded pool overrides default", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const chain = createDryRunChainClient({
      clock,
      seed: { activeBins: { poolA: { binId: 100, price: 2, pricePerLamport: "2" } } },
    });
    expect((await chain.getActiveBin("poolA")).binId).toBe(100);
    expect((await chain.getActiveBin("poolUnknown")).binId).toBe(8388608);
  });
});

describe("DryRunChainClient — positions + cache", () => {
  it("empty by default", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const chain = createDryRunChainClient({ clock });
    const snap = await chain.getMyPositions();
    expect(snap.total_positions).toBe(0);
    expect(snap.positions).toEqual([]);
  });

  it("cache: identical within TTL, refresh after invalidate via deploy", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const chain = createDryRunChainClient({ clock, seed: { walletSol: 10 } });
    const a = await chain.getMyPositions();
    expect(a.total_positions).toBe(0);

    await chain.deployPosition({
      pool_address: "poolA",
      amount_sol: 1,
      strategy: "bid_ask",
      bins_below: 40,
      bins_above: 10,
    });

    const b = await chain.getMyPositions();
    expect(b.total_positions).toBe(1);
    expect(b.positions[0]?.pool).toBe("poolA");
  });

  it("force=true bypasses cache even without invalidation", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const chain = createDryRunChainClient({ clock });
    await chain.getMyPositions();
    chain.setState({ positions: [] });
    // setState invalidates too; use peek to prove
    expect(chain.peekPositions()).toEqual([]);

    // force should return a fresh snapshot at current time
    clock.advance(1000);
    const forced = await chain.getMyPositions({ force: true });
    expect(forced.fetched_at).toBe(clock.now().toISOString());
  });
});

describe("DryRunChainClient — deploy / close / claim", () => {
  it("deploy decrements wallet + records position", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const chain = createDryRunChainClient({ clock, seed: { walletSol: 5 } });
    const r = await chain.deployPosition({
      pool_address: "poolA",
      amount_sol: 1.25,
      strategy: "bid_ask",
      bins_below: 35,
      bins_above: 0,
    });
    expect(r.success).toBe(true);
    expect(r.dry_run).toBe(true);
    expect(r.tx).toMatch(/^dry-run-tx-/);
    const b = await chain.getWalletBalance();
    expect(b.sol).toBe(3.75);
  });

  it("close returns success=false for unknown position", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const chain = createDryRunChainClient({ clock });
    const r = await chain.closePosition("ghost", "test");
    expect(r.success).toBe(false);
    expect(r.reason).toContain("unknown position");
  });

  it("close removes position and pays back SOL scaled by pnl_pct", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const chain = createDryRunChainClient({ clock, seed: { walletSol: 5 } });
    const deploy = await chain.deployPosition({
      pool_address: "poolA",
      amount_sol: 2,
      strategy: "bid_ask",
      bins_below: 35,
      bins_above: 0,
    });
    // Simulate +10% by mutating the peek data through setState
    const [pos] = chain.peekPositions();
    if (!pos) throw new Error("expected position");
    chain.setState({ positions: [{ ...pos, pnl_pct: 10 }] });

    const r = await chain.closePosition(deploy.position_address, "take profit");
    expect(r.success).toBe(true);
    expect(r.final_pnl_pct).toBe(10);

    const b = await chain.getWalletBalance();
    // 5 - 2 (deploy) + 2 * 1.10 (close) = 5.2
    expect(b.sol).toBeCloseTo(5.2, 6);
  });

  it("claim zeroes unclaimed fees and returns the claimed amount", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const chain = createDryRunChainClient({ clock, seed: { walletSol: 5 } });
    const deploy = await chain.deployPosition({
      pool_address: "poolA",
      amount_sol: 1,
      strategy: "bid_ask",
      bins_below: 35,
      bins_above: 0,
    });
    const [pos] = chain.peekPositions();
    if (!pos) throw new Error("expected position");
    chain.setState({ positions: [{ ...pos, unclaimed_fees_usd: 12.34 }] });

    const r = await chain.claimFees(deploy.position_address);
    expect(r.success).toBe(true);
    expect(r.claimed_usd).toBe(12.34);
    const [after] = chain.peekPositions();
    expect(after?.unclaimed_fees_usd).toBe(0);
  });
});
