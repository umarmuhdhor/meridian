import { describe, it, expect } from "vitest";
import {
  hardFilter,
  rankCandidates,
  summarizeRejections,
  defaultThresholds,
  type FilterContext,
  type ScreeningThresholds,
} from "../../src/domain/rules/screening.js";
import type { AppConfig } from "../../src/domain/schemas/config.js";
import type { CandidatePool } from "../../src/domain/schemas/market.js";
import { mgmt } from "./fixtures.js";

const config: AppConfig = {
  risk: { maxPositions: 3, maxDeployAmount: 50 },
  management: mgmt,
  strategy: { strategy: "bid_ask", minBinsBelow: 35, maxBinsBelow: 69, defaultBinsBelow: 69 },
  schedule: { managementIntervalMin: 10, screeningIntervalMin: 30, healthCheckIntervalMin: 60 },
};

function pool(over: Partial<CandidatePool> = {}): CandidatePool {
  return {
    pool_address: "poolA",
    name: "TKN/SOL",
    base_mint: "MINT_A",
    quote_mint: "So11111111111111111111111111111111111111112",
    tvl: 50_000,
    active_tvl: 40_000,
    volume_window: 20_000,
    fee_active_tvl_ratio: 0.1,
    fee_tvl_ratio: 0.08,
    organic_score: 75,
    holders: 1200,
    mcap: 400_000,
    bin_step: 100,
    volatility: 0.05,
    launchpad: null,
    token_age_hours: 24,
    active_pct: 60,
    ...over,
  };
}

const noCooldownCtx = (over: Partial<FilterContext> = {}): FilterContext => ({
  onPoolCooldown: () => false,
  onBaseMintCooldown: () => false,
  isBlacklisted: () => false,
  baseMintsInUse: new Set(),
  ...over,
});

describe("hardFilter — each rejection branch", () => {
  const th: ScreeningThresholds = defaultThresholds(config);

  it("clean pool passes", () => {
    const r = hardFilter([pool()], th, noCooldownCtx());
    expect(r.passed).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });

  it("tvl outside range rejects", () => {
    const r = hardFilter([pool({ tvl: 5_000 })], th, noCooldownCtx());
    expect(r.rejected[0]?.reason.kind).toBe("tvl_out_of_range");
  });

  it("low volume rejects", () => {
    const r = hardFilter([pool({ volume_window: 100 })], th, noCooldownCtx());
    expect(r.rejected[0]?.reason.kind).toBe("volume_below_min");
  });

  it("low organic rejects", () => {
    const r = hardFilter([pool({ organic_score: 30 })], th, noCooldownCtx());
    expect(r.rejected[0]?.reason.kind).toBe("organic_below_min");
  });

  it("low holders rejects", () => {
    const r = hardFilter([pool({ holders: 100 })], th, noCooldownCtx());
    expect(r.rejected[0]?.reason.kind).toBe("holders_below_min");
  });

  it("mcap out of range rejects", () => {
    const r = hardFilter([pool({ mcap: 20_000_000 })], th, noCooldownCtx());
    expect(r.rejected[0]?.reason.kind).toBe("mcap_out_of_range");
  });

  it("bin step out of range rejects", () => {
    const r = hardFilter([pool({ bin_step: 20 })], th, noCooldownCtx());
    expect(r.rejected[0]?.reason.kind).toBe("bin_step_out_of_range");
  });

  it("fee/TVL below floor rejects", () => {
    const r = hardFilter([pool({ fee_active_tvl_ratio: 0.01, fee_tvl_ratio: 0.01 })], th, noCooldownCtx());
    expect(r.rejected[0]?.reason.kind).toBe("fee_tvl_below_min");
  });

  it("launchpad blocked rejects", () => {
    const th2 = { ...th, blockedLaunchpads: ["pump.fun"] };
    const r = hardFilter([pool({ launchpad: "pump.fun" })], th2, noCooldownCtx());
    expect(r.rejected[0]?.reason.kind).toBe("launchpad_blocked");
  });

  it("launchpad not on allow-list rejects", () => {
    const th2 = { ...th, allowedLaunchpads: ["moonshot"] };
    const r = hardFilter([pool({ launchpad: "pump.fun" })], th2, noCooldownCtx());
    expect(r.rejected[0]?.reason.kind).toBe("launchpad_not_allowed");
  });

  it("pool cooldown rejects", () => {
    const r = hardFilter([pool()], th, noCooldownCtx({ onPoolCooldown: () => true }));
    expect(r.rejected[0]?.reason.kind).toBe("on_pool_cooldown");
  });

  it("base mint cooldown rejects", () => {
    const r = hardFilter([pool()], th, noCooldownCtx({ onBaseMintCooldown: () => true }));
    expect(r.rejected[0]?.reason.kind).toBe("on_base_mint_cooldown");
  });

  it("blacklisted base mint rejects", () => {
    const r = hardFilter([pool()], th, noCooldownCtx({ isBlacklisted: (m) => m === "MINT_A" }));
    expect(r.rejected[0]?.reason.kind).toBe("base_mint_blacklisted");
  });

  it("base mint already in use rejects", () => {
    const r = hardFilter([pool()], th, noCooldownCtx({ baseMintsInUse: new Set(["MINT_A"]) }));
    expect(r.rejected[0]?.reason.kind).toBe("base_mint_already_in_use");
  });

  it("multiple pools separate into passed + rejected buckets", () => {
    const r = hardFilter(
      [pool({ pool_address: "poolA" }), pool({ pool_address: "poolB", tvl: 1 })],
      th,
      noCooldownCtx(),
    );
    expect(r.passed.map((p) => p.pool_address)).toEqual(["poolA"]);
    expect(r.rejected[0]?.pool.pool_address).toBe("poolB");
  });
});

describe("rankCandidates", () => {
  it("sorts descending by scoreCandidate output", () => {
    const a = pool({ pool_address: "a", fee_active_tvl_ratio: 0.05, organic_score: 60 });
    const b = pool({ pool_address: "b", fee_active_tvl_ratio: 0.2, organic_score: 90 });
    const r = rankCandidates([a, b]);
    expect(r[0]?.pool.pool_address).toBe("b");
    expect(r[1]?.pool.pool_address).toBe("a");
    expect(r[0]?.score).toBeGreaterThan(r[1]?.score ?? 0);
  });
});

describe("summarizeRejections", () => {
  it("counts each reason kind and sorts by count desc", () => {
    const rejected = [
      { pool: pool({ pool_address: "1" }), reason: { kind: "volume_below_min" as const, value: 0, min: 500 } },
      { pool: pool({ pool_address: "2" }), reason: { kind: "volume_below_min" as const, value: 0, min: 500 } },
      { pool: pool({ pool_address: "3" }), reason: { kind: "on_pool_cooldown" as const } },
    ];
    const s = summarizeRejections(rejected);
    expect(s[0]).toContain("volume_below_min");
    expect(s[0]).toContain("(2)");
    expect(s[1]).toContain("on_pool_cooldown");
    expect(s[1]).toContain("(1)");
  });
});
