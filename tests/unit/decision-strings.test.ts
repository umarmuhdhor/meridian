import { describe, expect, it } from "vitest";
import {
  activeBinPosition,
  binRangeToPricePct,
  explainCloseReason,
  explainStrategy,
  formatCloseReason,
  formatCloseSummary,
  formatDeployReason,
  formatDeploySummary,
  formatInsufficientSolReason,
  formatMaxPositionsReason,
  formatNoCandidatesReason,
} from "../../src/domain/format/decision-strings.js";

describe("binRangeToPricePct", () => {
  it("returns null when bin_step unknown or non-positive", () => {
    expect(binRangeToPricePct(null, 0, 10)).toBeNull();
    expect(binRangeToPricePct(0, 0, 10)).toBeNull();
    expect(binRangeToPricePct(undefined, 0, 10)).toBeNull();
  });

  it("computes % correctly (bin_step=100 → 1% per bin, 55 bins ≈ 72%)", () => {
    const pct = binRangeToPricePct(100, -55, 0);
    expect(pct).not.toBeNull();
    // (1.01)^55 - 1 ≈ 0.7285 → 72.85%
    expect(pct).toBeCloseTo(72.85, 1);
  });

  it("returns 0 for a zero-width range", () => {
    expect(binRangeToPricePct(100, 5, 5)).toBe(0);
  });
});

describe("activeBinPosition", () => {
  it("labels edge, middle, and out-of-range positions", () => {
    expect(activeBinPosition(10, 0, 10)).toBe("at the top edge");
    expect(activeBinPosition(0, 0, 10)).toBe("at the bottom edge");
    expect(activeBinPosition(5, 0, 10)).toBe("in the middle");
    expect(activeBinPosition(15, 0, 10)).toBe("above range");
    expect(activeBinPosition(-5, 0, 10)).toBe("below range");
  });
});

describe("explainStrategy / explainCloseReason", () => {
  it("returns a human phrase for known strategies", () => {
    expect(explainStrategy("bid_ask")).toContain("bid-ask");
    expect(explainStrategy("curve")).toContain("stable");
    expect(explainStrategy("spot")).toContain("evenly");
    expect(explainStrategy("mystery")).toBe("mystery");
  });

  it("explains stop loss / take profit / OOR", () => {
    expect(explainCloseReason("stop loss")).toContain("loss");
    expect(explainCloseReason("take profit")).toContain("gain");
    expect(explainCloseReason("trailing take profit")).toContain("peak");
    expect(explainCloseReason("pumped above range")).toContain("100% base token");
  });
});

describe("formatDeploySummary / formatDeployReason", () => {
  const base = {
    pool_name: "BONK/SOL",
    pool_address: "AakC3joD",
    amount_sol: 0.3,
    strategy: "bid_ask",
    lower_bin: -484,
    upper_bin: -429,
    active_bin: -429,
    bin_step: 100,
  };

  it("summary mentions pool, amount, strategy", () => {
    const s = formatDeploySummary(base);
    expect(s).toContain("BONK/SOL");
    expect(s).toContain("0.3 SOL");
    expect(s).toContain("bid-ask");
  });

  it("reason includes range %, strategy gloss, and edge position", () => {
    const r = formatDeployReason(base);
    expect(r).toContain("bid-ask");
    expect(r).toContain("55-bin");
    expect(r).toMatch(/±72\.9%/);
    expect(r).toContain("at the top edge");
  });

  it("reason falls back when bin_step missing", () => {
    const r = formatDeployReason({ ...base, bin_step: null });
    expect(r).toContain("bin step unknown");
    expect(r).not.toContain("±");
  });
});

describe("formatCloseSummary / formatCloseReason", () => {
  it("summary shows PnL with + sign and reason phrase", () => {
    const s = formatCloseSummary({
      position_address: "posABC",
      final_pnl_pct: 12.5,
      final_value_usd: 112,
      fees_earned_usd: 2,
      reason: "take profit",
    });
    expect(s).toMatch(/PnL \+12\.50%/);
    expect(s).toContain("take profit");
  });

  it("reason includes exit trigger, PnL, value, fees", () => {
    const r = formatCloseReason({
      position_address: "posABC",
      final_pnl_pct: -55,
      final_value_usd: 45,
      fees_earned_usd: 0.5,
      reason: "stop loss",
    });
    expect(r).toContain("stop-loss");
    expect(r).toContain("-55.00%");
    expect(r).toContain("$45.00");
    expect(r).toContain("$0.50");
  });
});

describe("skip / no-deploy reasons", () => {
  it("insufficient SOL includes deploy + gas breakdown and shortage", () => {
    const r = formatInsufficientSolReason(0, 0.55, 0.3, 0.25);
    expect(r).toContain("0.0000 SOL");
    expect(r).toContain("0.5500");
    expect(r).toContain("0.3 deploy");
    expect(r).toContain("0.25 gas");
    expect(r).toContain("Short 0.5500");
  });

  it("max positions reason names the cap and lists exit triggers", () => {
    const r = formatMaxPositionsReason(3, 3);
    expect(r).toContain("3-position cap");
    expect(r).toContain("(3 open)");
    expect(r).toMatch(/stop-loss|take-profit|OOR/);
  });

  it("no candidates reason lists up to 5 details + summarizes counts", () => {
    const details = [
      "BONK/SOL — already holding a position in this token",
      "WIF/SOL — volume $500 below $10000 min",
      "POPCAT/SOL — fee/TVL 0.20% below 1.00% min",
      "MEW/SOL — only 30 holders (need ≥ 200)",
      "FART/SOL — market cap $50k outside $200k–$10M",
      "SIXTH/SOL — pool is on cooldown (recently deployed to / recently lost on)",
    ];
    const r = formatNoCandidatesReason(50, 47, details);
    expect(r).toContain("Scanned 50");
    expect(r).toContain("47 filtered out");
    expect(r).toContain("BONK/SOL");
    expect(r).toContain("+1 more");
    expect(r).not.toContain("SIXTH/SOL");
  });
});
