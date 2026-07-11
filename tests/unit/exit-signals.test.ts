import { describe, it, expect } from "vitest";
import { evaluateExit } from "../../src/domain/rules/exit-signals.js";
import { makeLive, makeTracked, mgmt } from "./fixtures.js";

const NOW = new Date("2026-07-05T12:00:00.000Z");

describe("evaluateExit — pure state diff + signal", () => {
  it("closed positions produce no updates and no signal", () => {
    const { updates, signal } = evaluateExit(
      makeTracked({ closed: true }),
      makeLive({ pnl_pct: -95 }),
      mgmt,
      { now: NOW },
    );
    expect(updates).toEqual({});
    expect(signal).toBeNull();
  });

  it("STOP_LOSS fires when pnl <= stopLoss", () => {
    const { signal } = evaluateExit(makeTracked(), makeLive({ pnl_pct: -60 }), mgmt, { now: NOW });
    expect(signal?.action).toBe("STOP_LOSS");
  });

  it("activates trailing when peak >= trigger", () => {
    const { updates } = evaluateExit(
      makeTracked({ peak_pnl_pct: 3 }),
      makeLive({ pnl_pct: 3 }),
      mgmt,
      { now: NOW },
    );
    expect(updates.trailing_active).toBe(true);
  });

  it("TRAILING_TP fires with needs_confirmation when trailing active and drop meets threshold", () => {
    const { signal } = evaluateExit(
      makeTracked({ peak_pnl_pct: 5, trailing_active: true }),
      makeLive({ pnl_pct: 3.4 }),
      mgmt,
      { now: NOW },
    );
    expect(signal?.action).toBe("TRAILING_TP");
    expect(signal?.needs_confirmation).toBe(true);
    expect(signal?.peak_pnl_pct).toBe(5);
    expect(signal?.current_pnl_pct).toBe(3.4);
    expect(signal?.drop_from_peak_pct).toBeCloseTo(1.6, 5);
  });

  it("TRAILING_TP does NOT fire when drop below threshold", () => {
    const { signal } = evaluateExit(
      makeTracked({ peak_pnl_pct: 5, trailing_active: true }),
      makeLive({ pnl_pct: 4 }),
      mgmt,
      { now: NOW },
    );
    expect(signal).toBeNull();
  });

  it("marks OOR timestamp when snapshot shows in_range=false and none stored", () => {
    const { updates, signal } = evaluateExit(
      makeTracked(),
      makeLive({ pnl_pct: 0, in_range: false }),
      mgmt,
      { now: NOW },
    );
    expect(updates.out_of_range_since).toBe(NOW.toISOString());
    expect(signal).toBeNull();
  });

  it("clears OOR timestamp when back in range", () => {
    const { updates } = evaluateExit(
      makeTracked({ out_of_range_since: "2026-07-05T11:00:00.000Z" }),
      makeLive({ pnl_pct: 0, in_range: true }),
      mgmt,
      { now: NOW },
    );
    expect(updates.out_of_range_since).toBeNull();
  });

  it("OUT_OF_RANGE signal fires when OOR for >= outOfRangeWaitMinutes", () => {
    const thirtyMinAgo = new Date(NOW.getTime() - 30 * 60_000).toISOString();
    const { signal } = evaluateExit(
      makeTracked({ out_of_range_since: thirtyMinAgo }),
      makeLive({ pnl_pct: 0, in_range: false }),
      mgmt,
      { now: NOW },
    );
    expect(signal?.action).toBe("OUT_OF_RANGE");
    expect(signal?.reason).toContain("30m");
  });

  it("LOW_YIELD signal fires when fee_per_tvl_24h under floor and age >= min", () => {
    const { signal } = evaluateExit(
      makeTracked(),
      makeLive({ pnl_pct: 0, fee_per_tvl_24h: 1, age_minutes: 90 }),
      mgmt,
      { now: NOW },
    );
    expect(signal?.action).toBe("LOW_YIELD");
  });

  it("LOW_YIELD does NOT fire when position too young", () => {
    const { signal } = evaluateExit(
      makeTracked(),
      makeLive({ pnl_pct: 0, fee_per_tvl_24h: 1, age_minutes: 30 }),
      mgmt,
      { now: NOW },
    );
    expect(signal).toBeNull();
  });

  it("suspect pnl gates STOP_LOSS but LOW_YIELD still fires", () => {
    const { signal } = evaluateExit(
      makeTracked(),
      makeLive({
        pnl_pct: -95,
        pnl_pct_suspicious: true,
        fee_per_tvl_24h: 1,
        age_minutes: 90,
      }),
      mgmt,
      { now: NOW },
    );
    expect(signal?.action).toBe("LOW_YIELD");
  });
});
