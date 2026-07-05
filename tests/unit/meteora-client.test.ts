import { describe, it, expect } from "vitest";
import {
  createMeteoraChainClient,
  MeteoraWritePathNotPortedError,
} from "../../src/adapters/chain/meteora/client.js";
import { createStaticPriceOracle } from "../../src/adapters/market/static-price-oracle.js";
import { fixedClock } from "../../src/ports/clock.js";
import { nullLogger } from "../../src/ports/logger.js";
import { lamportsToSol } from "../../src/adapters/chain/meteora/connection.js";
import type { SolanaConnection, WalletKeypair } from "../../src/ports/solana.js";

function fakeConnection(lamports: bigint): SolanaConnection {
  return {
    endpoint: "fake://localhost",
    raw: {},
    async getLamports() { return lamports; },
  };
}

const fakeWallet: WalletKeypair = {
  address: "TestWa11et111111111111111111111111111111111",
  raw: {},
};

const CLOCK = fixedClock("2026-07-05T12:00:00.000Z");

describe("MeteoraChainClient — read paths", () => {
  it("getWalletBalance: lamports → SOL + USD via price oracle", async () => {
    const connection = fakeConnection(2_500_000_000n); // 2.5 SOL
    const price = createStaticPriceOracle(180);
    const chain = createMeteoraChainClient({
      connection,
      wallet: fakeWallet,
      price,
      clock: CLOCK,
      logger: nullLogger,
    });
    const b = await chain.getWalletBalance();
    expect(b.sol).toBe(2.5);
    expect(b.sol_usd).toBe(450);
    expect(b.sol_price).toBe(180);
    expect(b.fetched_at).toBe("2026-07-05T12:00:00.000Z");
  });

  it("getWalletBalance: 4-decimal SOL rounding", async () => {
    const chain = createMeteoraChainClient({
      connection: fakeConnection(1_234_567_891n),
      wallet: fakeWallet,
      price: createStaticPriceOracle(100),
      clock: CLOCK,
      logger: nullLogger,
    });
    const b = await chain.getWalletBalance();
    expect(b.sol).toBe(1.2346);
  });
});

describe("MeteoraChainClient — write paths gated", () => {
  const chain = createMeteoraChainClient({
    connection: fakeConnection(1_000_000_000n),
    wallet: fakeWallet,
    price: createStaticPriceOracle(150),
    clock: CLOCK,
    logger: nullLogger,
  });

  it("deployPosition throws NotPorted", async () => {
    await expect(chain.deployPosition({
      pool_address: "poolA",
      amount_sol: 1,
      strategy: "bid_ask",
      bins_below: 40,
      bins_above: 0,
    })).rejects.toBeInstanceOf(MeteoraWritePathNotPortedError);
  });

  it("closePosition throws NotPorted", async () => {
    await expect(chain.closePosition("posA", "test")).rejects.toBeInstanceOf(MeteoraWritePathNotPortedError);
  });

  it("claimFees throws NotPorted", async () => {
    await expect(chain.claimFees("posA")).rejects.toBeInstanceOf(MeteoraWritePathNotPortedError);
  });

  it("NotPorted error message points at MERIDIAN_CHAIN=dryrun escape", async () => {
    const err = await chain.deployPosition({
      pool_address: "poolA",
      amount_sol: 1,
      strategy: "bid_ask",
      bins_below: 40,
      bins_above: 0,
    }).catch((e: Error) => e);
    expect(err.message).toContain("MERIDIAN_CHAIN=dryrun");
  });
});

describe("lamportsToSol precision", () => {
  it("1 lamport ≈ 0.000000001 SOL, exactly for whole SOL", () => {
    expect(lamportsToSol(1_000_000_000n)).toBe(1);
    expect(lamportsToSol(0n)).toBe(0);
    expect(lamportsToSol(500_000_000n)).toBe(0.5);
  });

  it("handles bigint sums beyond Number.MAX_SAFE_INTEGER without loss on the whole part", () => {
    // 9,007 SOL — whole-part < 2^53
    expect(lamportsToSol(9_007_000_000_000n)).toBe(9007);
  });
});
