import { describe, it, expect } from "vitest";
import { getDeterministicCloseRule, isPnlSuspect } from "../../src/domain/rules/close-rules.js";
import { makeLive, mgmt } from "./fixtures.js";

describe("getDeterministicCloseRule — 5 hard rules", () => {
  it("rule 1: stop loss when pnl_pct <= stopLossPct", () => {
    const r = getDeterministicCloseRule(makeLive({ pnl_pct: -50 }), mgmt);
    expect(r).toEqual({ action: "CLOSE", rule: 1, reason: "stop loss" });

    const worse = getDeterministicCloseRule(makeLive({ pnl_pct: -75 }), mgmt);
    expect(worse?.rule).toBe(1);
  });

  it("rule 1: NOT triggered when pnl_pct above stopLossPct", () => {
    const r = getDeterministicCloseRule(makeLive({ pnl_pct: -49.99 }), mgmt);
    expect(r).toBeNull();
  });

  it("rule 2: take profit when pnl_pct >= takeProfitPct", () => {
    const r = getDeterministicCloseRule(makeLive({ pnl_pct: 5 }), mgmt);
    expect(r).toEqual({ action: "CLOSE", rule: 2, reason: "take profit" });
  });

  it("rule 3: pumped far above range fires before rule 4 OOR", () => {
    const r = getDeterministicCloseRule(
      makeLive({ pnl_pct: 0, active_bin: 121, upper_bin: 110, minutes_out_of_range: 5 }),
      mgmt,
    );
    expect(r).toEqual({ action: "CLOSE", rule: 3, reason: "pumped far above range" });
  });

  it("rule 4: OOR when past upper AND minutes_out_of_range >= threshold", () => {
    const r = getDeterministicCloseRule(
      makeLive({ pnl_pct: 0, active_bin: 115, upper_bin: 110, minutes_out_of_range: 30 }),
      mgmt,
    );
    expect(r).toEqual({ action: "CLOSE", rule: 4, reason: "OOR" });
  });

  it("rule 4: NOT triggered if not yet at wait threshold", () => {
    const r = getDeterministicCloseRule(
      makeLive({ pnl_pct: 0, active_bin: 115, upper_bin: 110, minutes_out_of_range: 29 }),
      mgmt,
    );
    expect(r).toBeNull();
  });

  it("rule 5: low yield only after 60m age", () => {
    const young = getDeterministicCloseRule(
      makeLive({ pnl_pct: 0, fee_per_tvl_24h: 1, age_minutes: 59 }),
      mgmt,
    );
    expect(young).toBeNull();

    const ripe = getDeterministicCloseRule(
      makeLive({ pnl_pct: 0, fee_per_tvl_24h: 1, age_minutes: 60 }),
      mgmt,
    );
    expect(ripe).toEqual({ action: "CLOSE", rule: 5, reason: "low yield" });
  });

  it("suspicious pnl gates rules 1 and 2 but leaves 3/4/5 intact", () => {
    const suspect = getDeterministicCloseRule(
      makeLive({ pnl_pct: -95, pnl_pct_suspicious: true }),
      mgmt,
    );
    expect(suspect).toBeNull();

    const suspectButPumped = getDeterministicCloseRule(
      makeLive({
        pnl_pct: -95,
        pnl_pct_suspicious: true,
        active_bin: 121,
        upper_bin: 110,
      }),
      mgmt,
    );
    expect(suspectButPumped?.rule).toBe(3);
  });

  it("null pnl_pct: rules 1+2 skipped, other rules still evaluated", () => {
    const r = getDeterministicCloseRule(
      makeLive({ pnl_pct: null, active_bin: 121, upper_bin: 110 }),
      mgmt,
    );
    expect(r?.rule).toBe(3);
  });

  it("returns null when nothing fires", () => {
    const r = getDeterministicCloseRule(makeLive({ pnl_pct: 1, fee_per_tvl_24h: 20 }), mgmt);
    expect(r).toBeNull();
  });
});

describe("isPnlSuspect", () => {
  it("explicit suspicious flag → true", () => {
    expect(isPnlSuspect({ pnl_pct: 0, pnl_pct_suspicious: true, total_value_usd: 0 })).toBe(true);
  });

  it("null pnl_pct → false (not the same as suspicious)", () => {
    expect(isPnlSuspect({ pnl_pct: null, pnl_pct_suspicious: false, total_value_usd: 0 })).toBe(false);
  });

  it("pnl_pct > -90 → false regardless of tracked amount", () => {
    expect(
      isPnlSuspect(
        { pnl_pct: -50, pnl_pct_suspicious: false, total_value_usd: 100 },
        { tracked: { amount_sol: 1 } },
      ),
    ).toBe(false);
  });

  it("pnl_pct <= -90 AND tracked has amount AND value > 0.01 → true", () => {
    expect(
      isPnlSuspect(
        { pnl_pct: -95, pnl_pct_suspicious: false, total_value_usd: 5 },
        { tracked: { amount_sol: 1 } },
      ),
    ).toBe(true);
  });

  it("pnl_pct <= -90 but tracked has no amount → false", () => {
    expect(
      isPnlSuspect(
        { pnl_pct: -95, pnl_pct_suspicious: false, total_value_usd: 100 },
        { tracked: null },
      ),
    ).toBe(false);
  });
});
