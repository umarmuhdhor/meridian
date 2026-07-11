import { describe, it, expect } from "vitest";
import { assessPnl, roundNum } from "../../src/domain/rules/pnl.js";

describe("assessPnl", () => {
  it("both null → suspicious, pnl_pct null", () => {
    const r = assessPnl(null, null, 5);
    expect(r.pnl_pct_suspicious).toBe(true);
    expect(r.pnl_pct).toBeNull();
    expect(r.divergence_pct).toBeNull();
    expect(r.divergent).toBe(false);
  });

  it("prefers reported over derived", () => {
    const r = assessPnl(3, 2.5, 5);
    expect(r.pnl_pct).toBe(3);
    expect(r.divergence_pct).toBeCloseTo(0.5, 5);
    expect(r.divergent).toBe(false);
  });

  it("falls back to derived when reported null", () => {
    const r = assessPnl(null, -4, 5);
    expect(r.pnl_pct).toBe(-4);
    expect(r.pnl_pct_suspicious).toBe(false);
    expect(r.divergence_pct).toBeNull();
  });

  it("divergent=true when diff exceeds threshold, but pnl_pct still populated", () => {
    const r = assessPnl(10, 3, 5);
    expect(r.divergent).toBe(true);
    expect(r.pnl_pct).toBe(10);
    expect(r.pnl_pct_suspicious).toBe(false);
  });

  it("non-finite values coerced to null", () => {
    const r = assessPnl(Number.NaN, Number.POSITIVE_INFINITY, 5);
    expect(r.pnl_pct_suspicious).toBe(true);
    expect(r.pnl_pct).toBeNull();
  });
});

describe("roundNum", () => {
  it("rounds to given decimals", () => {
    expect(roundNum(1.23456, 2)).toBe(1.23);
    expect(roundNum(1.235, 2)).toBe(1.24);
    // Float representation: -1.235 * 100 = -123.50000000000001, so Math.round drops it to -124.
    expect(roundNum(-1.235, 2)).toBe(-1.24);
    expect(roundNum(0, 4)).toBe(0);
  });
});
