import { describe, it, expect, vi } from "vitest";
import { nullLogger } from "../../src/ports/logger.js";
import {
  createJupiterTokenInfo,
  type FetchImpl,
} from "../../src/adapters/market/jupiter-token-info.js";

const now = () => new Date("2026-07-05T12:00:00.000Z");

function jsonRes(body: unknown, status = 200): Awaited<ReturnType<FetchImpl>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const MINT = "MemeMint111111111111111111111111111111111";

describe("createJupiterTokenInfo.getInfo", () => {
  it("normalizes an /assets/search top result", async () => {
    const twoDaysAgoMs = now().getTime() - 48 * 3_600_000;
    const fetchImpl = vi.fn<FetchImpl>(async (url: string) => {
      expect(url).toContain("/assets/search?query=");
      return jsonRes([
        {
          id: MINT,
          name: "Meme Coin",
          symbol: "MEME",
          mcap: "480000",
          usdPrice: "0.05",
          holderCount: "1200",
          launchpad: "pump.fun",
          dev: "DevWallet1",
          totalSupply: "1000000000",
          createdAt: twoDaysAgoMs,
        },
      ]);
    });
    const client = createJupiterTokenInfo({ logger: nullLogger, now, fetchImpl });
    const info = await client.getInfo(MINT);
    expect(info.mint).toBe(MINT);
    expect(info.symbol).toBe("MEME");
    expect(info.name).toBe("Meme Coin");
    expect(info.mcap).toBe(480_000);
    expect(info.holders).toBe(1200);
    expect(info.launchpad).toBe("pump.fun");
    expect(info.deployer).toBe("DevWallet1");
    expect(info.supply).toBe(1_000_000_000);
    expect(info.age_hours).toBeCloseTo(48, 0);
  });

  it("returns a minimal TokenInfo when the endpoint errors", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({ err: "no" }, 500));
    const client = createJupiterTokenInfo({ logger: nullLogger, now, fetchImpl });
    const info = await client.getInfo(MINT);
    expect(info.mint).toBe(MINT);
    expect(info.symbol).toBeNull();
    expect(info.mcap).toBeNull();
  });

  it("returns a minimal TokenInfo when response shape is unrecognized", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({ nope: true }));
    const client = createJupiterTokenInfo({ logger: nullLogger, now, fetchImpl });
    const info = await client.getInfo(MINT);
    expect(info.mint).toBe(MINT);
    expect(info.symbol).toBeNull();
  });
});

describe("createJupiterTokenInfo.getHolders", () => {
  it("normalizes holder rows and aggregates top10 + bot pct", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (url: string) => {
      expect(url).toContain("/holders/");
      return jsonRes({
        holders: [
          ...Array.from({ length: 10 }, (_, i) => ({
            owner: `Holder${i}`,
            percent: 3,
            amount: 1000,
            label: null,
          })),
          { owner: "BotWallet1", percent: 5, label: "bot" },
          { owner: "BotWallet2", percent: 2, label: "bot" },
          { owner: "Retail", percent: 1 },
        ],
      });
    });
    const client = createJupiterTokenInfo({ logger: nullLogger, now, fetchImpl });
    const s = await client.getHolders(MINT);
    expect(s.mint).toBe(MINT);
    expect(s.count).toBe(13);
    expect(s.top10_pct).toBeCloseTo(30, 5); // first 10 × 3%
    expect(s.bot_pct).toBeCloseTo(7, 5);
    expect(s.top.length).toBeLessThanOrEqual(20);
  });

  it("returns an empty summary when the endpoint errors", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({ err: 1 }, 500));
    const client = createJupiterTokenInfo({ logger: nullLogger, now, fetchImpl });
    const s = await client.getHolders(MINT);
    expect(s.count).toBe(0);
    expect(s.top).toEqual([]);
  });
});

describe("createJupiterTokenInfo.getNarrative", () => {
  it("returns the narrative + tags from ChainInsight", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (url: string) => {
      expect(url).toContain("/chaininsight/narrative/");
      return jsonRes({ narrative: "cat-themed", tags: ["cat", "meme"], status: "ok" });
    });
    const client = createJupiterTokenInfo({ logger: nullLogger, now, fetchImpl });
    const n = await client.getNarrative(MINT);
    expect(n.narrative).toBe("cat-themed");
    expect(n.tags).toEqual(["cat", "meme"]);
  });

  it("returns null narrative + [] tags on error", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({ err: 1 }, 500));
    const client = createJupiterTokenInfo({ logger: nullLogger, now, fetchImpl });
    const n = await client.getNarrative(MINT);
    expect(n.narrative).toBeNull();
    expect(n.tags).toEqual([]);
  });
});
