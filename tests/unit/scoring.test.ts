import { describe, it, expect } from "vitest";
import { scoreCandidate } from "../../src/domain/rules/scoring.js";

describe("scoreCandidate", () => {
  it("matches the JS formula exactly: feeTvl*1000 + organic*10 + vol/100 + holders/100", () => {
    const s = scoreCandidate({
      fee_active_tvl_ratio: 0.1,
      organic_score: 80,
      volume_window: 50_000,
      holders: 1_200,
    });
    expect(s).toBe(0.1 * 1000 + 80 * 10 + 50_000 / 100 + 1_200 / 100);
  });

  it("prefers fee_active_tvl_ratio over fee_tvl_ratio", () => {
    const a = scoreCandidate({ fee_active_tvl_ratio: 0.2, fee_tvl_ratio: 0.05 });
    const b = scoreCandidate({ fee_tvl_ratio: 0.05 });
    expect(a).toBe(0.2 * 1000);
    expect(b).toBe(0.05 * 1000);
  });

  it("missing / null / non-finite inputs coerced to 0", () => {
    expect(scoreCandidate({})).toBe(0);
    expect(scoreCandidate({ fee_tvl_ratio: null, organic_score: undefined, volume_window: Number.NaN })).toBe(0);
  });

  it("scores strictly higher for higher fee/TVL, all else equal", () => {
    const lo = scoreCandidate({ fee_active_tvl_ratio: 0.05, organic_score: 60 });
    const hi = scoreCandidate({ fee_active_tvl_ratio: 0.15, organic_score: 60 });
    expect(hi).toBeGreaterThan(lo);
  });
});
