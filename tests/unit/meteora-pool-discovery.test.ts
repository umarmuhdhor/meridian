import { describe, it, expect, vi } from "vitest";
import { nullLogger } from "../../src/ports/logger.js";
import { createMeteoraPoolDiscovery } from "../../src/adapters/market/meteora-pool-discovery.js";
import type { FetchImpl } from "../../src/adapters/market/meteora-pool-discovery.js";
import type { ScreeningConfig } from "../../src/domain/schemas/config.js";

const now = () => new Date("2026-07-05T12:00:00.000Z");

const screening: ScreeningConfig = {
  excludeHighSupplyConcentration: true,
  minFeeActiveTvlRatio: 0.05,
  minTvl: 10_000,
  maxTvl: 150_000,
  minVolume: 500,
  minOrganic: 60,
  minQuoteOrganic: 60,
  minHolders: 500,
  minMcap: 150_000,
  maxMcap: 10_000_000,
  minBinStep: 80,
  maxBinStep: 125,
  timeframe: "5m",
  category: "trending",
  minTokenFeesSol: 30,
  useDiscordSignals: false,
  discordSignalMode: "merge",
  avoidPvpSymbols: true,
  blockPvpSymbols: false,
  maxBotHoldersPct: 30,
  maxTop10Pct: 60,
  allowedLaunchpads: [],
  blockedLaunchpads: [],
  minTokenAgeHours: null,
  maxTokenAgeHours: null,
};

function jsonRes(body: unknown, status = 200): Awaited<ReturnType<FetchImpl>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function rawPool(overrides: Record<string, unknown> = {}): unknown {
  return {
    pool_address: "PoolAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    name: "MEME/SOL",
    base_token_mint: "MemeMint111111111111111111111111111111111",
    quote_token_mint: "So11111111111111111111111111111111111111112",
    tvl: "25000",
    volume: "8000",
    fee_active_tvl_ratio: "0.11",
    fee_tvl_ratio: "0.08",
    base_token_organic_score: "72",
    base_token_holders: "1200",
    base_token_market_cap: "480000",
    dlmm_bin_step: 100,
    volatility: "0.06",
    base_token_launchpad: null,
    base_token_created_at: 1_720_000_000_000, // ms
    active_pct: "60",
    ...overrides,
  };
}

describe("createMeteoraPoolDiscovery.discover", () => {
  it("hits the pool-discovery /pools endpoint with filter_by DSL", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (url: string) => {
      expect(url).toContain("/pools?");
      expect(url).toContain("page_size=50");
      expect(url).toContain("timeframe=5m");
      expect(url).toContain("category=trending");
      const decoded = decodeURIComponent(url.split("filter_by=")[1]!.split("&")[0]!);
      expect(decoded).toContain("pool_type=dlmm");
      expect(decoded).toContain("base_token_market_cap>=150000");
      expect(decoded).toContain("base_token_market_cap<=10000000");
      expect(decoded).toContain("tvl>=10000");
      expect(decoded).toContain("dlmm_bin_step>=80");
      expect(decoded).toContain("fee_active_tvl_ratio>=0.05");
      return jsonRes({ data: [rawPool()] });
    });
    const client = createMeteoraPoolDiscovery({
      logger: nullLogger,
      screening,
      now,
      fetchImpl,
    });
    const pools = await client.discover();
    expect(pools).toHaveLength(1);
    const p = pools[0]!;
    expect(p.pool_address).toBe("PoolAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(p.base_mint).toBe("MemeMint111111111111111111111111111111111");
    expect(p.tvl).toBe(25_000);
    expect(p.organic_score).toBe(72);
    expect(p.holders).toBe(1200);
    expect(p.bin_step).toBe(100);
  });

  it("adds allowedLaunchpads filter when set", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (url: string) => {
      const decoded = decodeURIComponent(url.split("filter_by=")[1]!.split("&")[0]!);
      expect(decoded).toContain("base_token_launchpad=[pump.fun,letsbonk]");
      return jsonRes({ data: [] });
    });
    const client = createMeteoraPoolDiscovery({
      logger: nullLogger,
      screening: { ...screening, allowedLaunchpads: ["pump.fun", "letsbonk"] },
      now,
      fetchImpl,
    });
    await client.discover();
  });

  it("normalizes ms + seconds created_at into token_age_hours", async () => {
    const nowFn = () => new Date("2026-07-05T12:00:00.000Z");
    const nowMs = nowFn().getTime();
    const twoDaysAgoMs = nowMs - 48 * 3_600_000;
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      jsonRes({ data: [rawPool({ base_token_created_at: twoDaysAgoMs })] }),
    );
    const client = createMeteoraPoolDiscovery({
      logger: nullLogger,
      screening,
      now: nowFn,
      fetchImpl,
    });
    const [p] = await client.discover();
    expect(p?.token_age_hours).toBeCloseTo(48, 0);
  });

  it("drops rows without base mint / pool address", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      jsonRes({
        data: [
          rawPool(),
          { pool_address: "OK2", base_token_mint: "MintY", tvl: 5 },
          { pool_address: "NoBase" },
          { base_token_mint: "NoPool" },
        ],
      }),
    );
    const client = createMeteoraPoolDiscovery({
      logger: nullLogger,
      screening,
      now,
      fetchImpl,
    });
    const pools = await client.discover();
    expect(pools).toHaveLength(2);
  });

  it("throws on non-2xx response", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({ err: 1 }, 500));
    const client = createMeteoraPoolDiscovery({
      logger: nullLogger,
      screening,
      now,
      fetchImpl,
    });
    await expect(client.discover()).rejects.toThrow(/500/);
  });
});

describe("createMeteoraPoolDiscovery.getPoolDetail", () => {
  it("returns the first row from the detail endpoint", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (url: string) => {
      expect(url).toContain("page_size=1");
      expect(url).toContain("pool_address%3DPool1");
      return jsonRes({ data: [rawPool({ pool_address: "Pool1" })] });
    });
    const client = createMeteoraPoolDiscovery({
      logger: nullLogger,
      screening,
      now,
      fetchImpl,
    });
    const p = await client.getPoolDetail("Pool1");
    expect(p?.pool_address).toBe("Pool1");
  });

  it("returns null when detail endpoint returns empty data", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({ data: [] }));
    const client = createMeteoraPoolDiscovery({
      logger: nullLogger,
      screening,
      now,
      fetchImpl,
    });
    expect(await client.getPoolDetail("PoolX")).toBeNull();
  });
});

describe("createMeteoraPoolDiscovery.search", () => {
  it("hits the search endpoint and applies the limit", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async (url: string) => {
      expect(url).toContain("/pools?query=MEME");
      return jsonRes({ data: [rawPool(), rawPool({ pool_address: "P2" }), rawPool({ pool_address: "P3" })] });
    });
    const client = createMeteoraPoolDiscovery({
      logger: nullLogger,
      screening,
      now,
      fetchImpl,
    });
    const pools = await client.search("MEME", 2);
    expect(pools).toHaveLength(2);
  });
});
