import { describe, it, expect, vi } from "vitest";
import type { Clock } from "../../src/ports/clock.js";
import { nullLogger } from "../../src/ports/logger.js";
import type { SmartWallet } from "../../src/domain/schemas/smart-wallet.js";
import type { TokenInfoClient } from "../../src/ports/token-info-client.js";
import type { TokenHoldersSummary } from "../../src/domain/schemas/market.js";
import {
  createMeteoraSmartWalletChecker,
  type FetchImpl,
} from "../../src/adapters/market/meteora-smart-wallet-checker.js";

function mutableClock(startIso: string): Clock & { advance(ms: number): void } {
  let ms = new Date(startIso).getTime();
  return {
    now: () => new Date(ms),
    advance: (delta: number) => {
      ms += delta;
    },
  };
}

function jsonRes(body: unknown, status = 200): Awaited<ReturnType<FetchImpl>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const wallets: SmartWallet[] = [
  { name: "Alpha", address: "WalletA1", category: "kol", type: "lp", addedAt: "2026-01-01" },
  { name: "Beta", address: "WalletB2", category: "hunter", type: "lp", addedAt: "2026-01-01" },
  { name: "Whale", address: "WhaleH3", category: null as unknown as string, type: "holder", addedAt: "2026-01-01" },
];

function makeHolderTokenInfo(matchingAddresses: string[]): TokenInfoClient {
  return {
    async getInfo() {
      throw new Error("not used");
    },
    async getHolders(mint: string): Promise<TokenHoldersSummary> {
      return {
        mint,
        count: matchingAddresses.length,
        top10_pct: 0,
        bot_pct: 0,
        top: matchingAddresses.map((address) => ({
          address,
          pct: 1,
          label: null,
        })),
      };
    },
    async getNarrative(mint: string) {
      return { mint, narrative: null, tags: [] };
    },
  };
}

describe("createMeteoraSmartWalletChecker.checkPool (LP)", () => {
  it("returns matches for wallets currently in the pool", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const fetchImpl = vi.fn<FetchImpl>(async (url: string) => {
      if (url.includes("user=WalletA1")) return jsonRes({ pools: [{ poolAddress: "POOL_X" }] });
      if (url.includes("user=WalletB2")) return jsonRes({ pools: [{ poolAddress: "POOL_Y" }] });
      return jsonRes({ pools: [] });
    });
    const checker = createMeteoraSmartWalletChecker({
      logger: nullLogger,
      clock,
      loadWallets: async () => wallets.filter((w) => w.type === "lp"),
      fetchImpl,
    });
    const m = await checker.checkPool("POOL_X", null);
    expect(m).toHaveLength(1);
    expect(m[0]?.name).toBe("Alpha");
    expect(m[0]?.type).toBe("lp");
    expect(m[0]?.matched_via).toBe("position");
  });

  it("caches per-wallet portfolio responses for 5 minutes", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({ pools: [{ poolAddress: "POOL_X" }] }));
    const checker = createMeteoraSmartWalletChecker({
      logger: nullLogger,
      clock,
      loadWallets: async () => [wallets[0]!],
      fetchImpl,
    });
    await checker.checkPool("POOL_X", null);
    await checker.checkPool("POOL_X", null);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock.advance(6 * 60_000);
    await checker.checkPool("POOL_X", null);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns [] when no tracked wallets are loaded", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({ pools: [] }));
    const checker = createMeteoraSmartWalletChecker({
      logger: nullLogger,
      clock,
      loadWallets: async () => [],
      fetchImpl,
    });
    const m = await checker.checkPool("POOL_X", null);
    expect(m).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats portfolio 5xx as no match, does not throw", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({ err: 1 }, 500));
    const checker = createMeteoraSmartWalletChecker({
      logger: nullLogger,
      clock,
      loadWallets: async () => [wallets[0]!],
      fetchImpl,
    });
    const m = await checker.checkPool("POOL_X", null);
    expect(m).toEqual([]);
  });
});

describe("createMeteoraSmartWalletChecker.checkPool (holder)", () => {
  it("matches when the base mint holders list contains the wallet address", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({ pools: [] }));
    const checker = createMeteoraSmartWalletChecker({
      logger: nullLogger,
      clock,
      loadWallets: async () => [wallets[2]!], // Whale
      tokenInfo: makeHolderTokenInfo(["WhaleH3", "SomeoneElse"]),
      fetchImpl,
    });
    const m = await checker.checkPool("POOL_X", "MintY");
    expect(m).toHaveLength(1);
    expect(m[0]?.type).toBe("holder");
    expect(m[0]?.matched_via).toBe("holding");
  });

  it("does not run holder check when baseMint is null", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const spy = vi.fn(async (mint: string) => ({
      mint,
      count: 0,
      top10_pct: 0,
      bot_pct: 0,
      top: [],
    }));
    const tokenInfo: TokenInfoClient = {
      async getInfo() {
        throw new Error("nope");
      },
      getHolders: spy,
      async getNarrative(mint: string) {
        return { mint, narrative: null, tags: [] };
      },
    };
    const checker = createMeteoraSmartWalletChecker({
      logger: nullLogger,
      clock,
      loadWallets: async () => [wallets[2]!],
      tokenInfo,
      fetchImpl: (async () => jsonRes({ pools: [] })) as unknown as FetchImpl,
    });
    await checker.checkPool("POOL_X", null);
    expect(spy).not.toHaveBeenCalled();
  });
});
