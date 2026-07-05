import { describe, it, expect } from "vitest";
import {
  planDeploy,
  priceOfBin,
  WIDE_RANGE_THRESHOLD,
  type DeployPlanInput,
} from "../../src/domain/rules/deploy-planning.js";

const base: DeployPlanInput = {
  poolAddress: "PoolAaaa",
  activeBinId: 1000,
  binStep: 100,
  activePrice: priceOfBin(1000, 100),
  strategy: "bid_ask",
  binsBelow: 40,
  binsAbove: 0,
  amountY: 0.5,
};

describe("priceOfBin", () => {
  it("returns 1 for bin 0 regardless of step", () => {
    expect(priceOfBin(0, 100)).toBe(1);
    expect(priceOfBin(0, 1)).toBe(1);
  });

  it("grows monotonically with bin id", () => {
    expect(priceOfBin(10, 100)).toBeGreaterThan(priceOfBin(0, 100));
    expect(priceOfBin(100, 100)).toBeGreaterThan(priceOfBin(10, 100));
  });

  it("returns 0 on invalid inputs", () => {
    expect(priceOfBin(Number.NaN, 100)).toBe(0);
    expect(priceOfBin(10, 0)).toBe(0);
    expect(priceOfBin(10, -5)).toBe(0);
  });
});

describe("planDeploy — happy path", () => {
  it("plans a single-side SOL bid_ask deploy at the safety floor", () => {
    const plan = planDeploy({ ...base, binsBelow: 35 });
    expect(plan.strategy).toBe("bid_ask");
    expect(plan.isSingleSidedSol).toBe(true);
    expect(plan.minBinId).toBe(965);
    expect(plan.maxBinId).toBe(1000);
    expect(plan.totalBins).toBe(35);
    expect(plan.isWideRange).toBe(false);
    expect(plan.amountX).toBe(0);
    expect(plan.amountY).toBe(0.5);
    expect(plan.downsideCoveragePct).not.toBeNull();
    expect(plan.upsideCoveragePct).toBe(0); // single-sided: max == active
    expect(plan.totalWidthPct).not.toBeNull();
  });

  it("marks wide-range when total bins > 69", () => {
    const plan = planDeploy({ ...base, binsBelow: 70 });
    expect(plan.totalBins).toBe(70);
    expect(plan.isWideRange).toBe(true);
    expect(plan.totalBins).toBeGreaterThan(WIDE_RANGE_THRESHOLD);
  });

  it("supports curve + spot strategies", () => {
    expect(planDeploy({ ...base, strategy: "curve" }).strategy).toBe("curve");
    expect(planDeploy({ ...base, strategy: "spot" }).strategy).toBe("spot");
  });
});

describe("planDeploy — validation errors", () => {
  it("rejects amountX > 0 (dual-sided deploys unsupported)", () => {
    expect(() => planDeploy({ ...base, amountX: 0.1 })).toThrow(/only single-side SOL/i);
  });

  it("rejects amountY <= 0", () => {
    expect(() => planDeploy({ ...base, amountY: 0 })).toThrow(/amountY must be positive/i);
    expect(() => planDeploy({ ...base, amountY: -1 })).toThrow();
  });

  it("rejects NaN / Infinity amounts", () => {
    expect(() => planDeploy({ ...base, amountY: Number.NaN })).toThrow(/finite/i);
    expect(() => planDeploy({ ...base, amountY: Number.POSITIVE_INFINITY })).toThrow();
  });

  it("rejects non-integer bin counts", () => {
    expect(() => planDeploy({ ...base, binsBelow: 40.5 })).toThrow(/whole integers/i);
  });

  it("rejects negative bin counts", () => {
    expect(() => planDeploy({ ...base, binsBelow: -1 })).toThrow(/cannot be negative/i);
  });

  it("rejects total bins below the safety floor", () => {
    expect(() => planDeploy({ ...base, binsBelow: 20 })).toThrow(/safety floor/i);
  });

  it("honors caller-provided minBinsBelow but never drops below MIN_SAFE_BINS_BELOW", () => {
    expect(() => planDeploy({ ...base, binsBelow: 30, minBinsBelow: 25 })).toThrow(/safety floor 35/);
  });

  it("rejects single-side deploy with bins_above > 0", () => {
    expect(() =>
      planDeploy({ ...base, binsBelow: 40, binsAbove: 10 }),
    ).toThrow(/single-side SOL deploy cannot have bins_above/i);
  });

  it("rejects invalid activeBinId (non-integer)", () => {
    expect(() => planDeploy({ ...base, activeBinId: 1000.5 })).toThrow(/activeBinId/);
  });

  it("rejects non-positive binStep", () => {
    expect(() => planDeploy({ ...base, binStep: 0 })).toThrow(/binStep/);
    expect(() => planDeploy({ ...base, binStep: -5 })).toThrow(/binStep/);
  });
});

describe("planDeploy — coverage math", () => {
  it("downsideCoveragePct roughly matches (activePrice - minPrice) / activePrice * 100", () => {
    const plan = planDeploy({ ...base, binsBelow: 40 });
    const expected =
      ((base.activePrice - priceOfBin(base.activeBinId - 40, base.binStep)) / base.activePrice) *
      100;
    expect(plan.downsideCoveragePct!).toBeCloseTo(expected, 6);
  });

  it("returns null coverage when activePrice is 0", () => {
    const plan = planDeploy({ ...base, activePrice: 0, binsBelow: 40 });
    expect(plan.downsideCoveragePct).toBeNull();
    expect(plan.upsideCoveragePct).toBeNull();
  });
});
