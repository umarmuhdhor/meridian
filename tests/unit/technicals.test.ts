import { describe, expect, it } from "vitest";
import { computeTechnicals, formatTechnicalsLine } from "../../src/domain/format/technicals.js";
import type { KlineCandle } from "../../src/domain/schemas/kline.js";

function series(closes: number[], vol = 100): KlineCandle[] {
  return closes.map((c, i) => ({
    t: 1_000 + i * 60,
    o: c,
    h: c * 1.005,
    l: c * 0.995,
    c,
    v: vol,
  }));
}

describe("computeTechnicals — empty + guards", () => {
  it("returns all-nulls on empty input, no throw", () => {
    const t = computeTechnicals([], "5m");
    expect(t.candles).toBe(0);
    expect(t.last_close).toBeNull();
    expect(t.spike_pct).toBeNull();
    expect(t.trend).toBeNull();
    expect(t.nearest_support).toBeNull();
    expect(formatTechnicalsLine(t)).toBeNull();
  });

  it("short history yields nulls only on features that need more data", () => {
    const t = computeTechnicals(series([1, 1.01, 1.02]), "5m");
    expect(t.last_close).toBeCloseTo(1.02);
    expect(t.spike_pct).toBeNull(); // needs >= 21 candles
    expect(t.trend).toBeNull(); // EMA(50) needs >= 50
  });
});

describe("computeTechnicals — spike + local top", () => {
  it("detects a fresh pump as spike_pct > 0 + at_local_top=YES", () => {
    // 20 flat candles at 1.00, then a 40% pump.
    const closes = Array(20).fill(1.0).concat([1.4]);
    const t = computeTechnicals(series(closes), "5m", { windowShort: 20 });
    expect(t.spike_pct).not.toBeNull();
    expect(t.spike_pct!).toBeGreaterThan(35);
    expect(t.at_local_top).toBe(true);
    expect(t.at_local_bottom).toBe(false);
  });

  it("detects a fresh dump as spike_pct < 0 + at_local_bottom=YES", () => {
    const closes = Array(20).fill(1.0).concat([0.55]);
    const t = computeTechnicals(series(closes), "5m");
    expect(t.spike_pct!).toBeLessThan(-30);
    expect(t.at_local_bottom).toBe(true);
    expect(t.at_local_top).toBe(false);
  });
});

describe("computeTechnicals — trend (EMA short vs long)", () => {
  it("uptrending series → trend=UP", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 1 + i * 0.05);
    const t = computeTechnicals(series(closes), "1h");
    expect(t.trend).toBe("UP");
  });

  it("downtrending series → trend=DOWN", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 5 - i * 0.05);
    const t = computeTechnicals(series(closes), "1h");
    expect(t.trend).toBe("DOWN");
  });

  it("flat series → trend=FLAT", () => {
    const closes = Array(60).fill(1.0);
    const t = computeTechnicals(series(closes), "1h");
    expect(t.trend).toBe("FLAT");
  });
});

describe("computeTechnicals — swing-low support", () => {
  it("finds a support level BELOW current with touches counted", () => {
    // Two dips to ~0.90 that each qualify as swing lows (surrounded by higher
    // lows on each side), then a rally to 1.20. Support should sit near 0.90
    // with touches >= 2.
    const closes = [
      1.10, 1.05, 0.95, 0.90, 0.95, 1.00, 1.05, 1.05,   // dip 1
      1.05, 1.02, 0.94, 0.91, 0.96, 1.03, 1.07, 1.10,   // dip 2
      1.10, 1.15, 1.18, 1.20,                            // rally
    ];
    const t = computeTechnicals(series(closes), "1h", { swingWindow: 3, touchTolPct: 5 });
    expect(t.nearest_support).not.toBeNull();
    expect(t.nearest_support!).toBeLessThan(1.2);
    expect(t.support_distance_pct!).toBeLessThan(0); // support is below current
    expect(t.support_touches!).toBeGreaterThanOrEqual(2);
  });

  it("no swing lows below current → nulls", () => {
    // Straight uptrend, first candle is the low but not qualified (no left context).
    const t = computeTechnicals(series([1, 2, 3, 4, 5]), "1h");
    expect(t.nearest_support).toBeNull();
    expect(t.support_touches).toBeNull();
  });
});

describe("formatTechnicalsLine", () => {
  it("renders a compact line with only the fields that resolved", () => {
    const closes = Array(20).fill(1).concat([1.4]);
    const t = computeTechnicals(series(closes), "5m");
    const line = formatTechnicalsLine(t)!;
    expect(line.startsWith("5m: ")).toBe(true);
    expect(line).toContain("spike=+");
    expect(line).toContain("at_local_top=YES");
    expect(line).toContain("price=");
  });
});

describe("computeTechnicals — consecutive_red_count", () => {
  const c = (o: number, close: number): KlineCandle => ({ t: 0, o, h: Math.max(o, close), l: Math.min(o, close), c: close, v: 100 });
  it("counts trailing red candles (close < open), back from the last", () => {
    // green, green, red, red, red  → streak 3
    const candles = [c(1, 2), c(2, 3), c(3, 2), c(2, 1.5), c(1.5, 1)];
    expect(computeTechnicals(candles, "15m").consecutive_red_count).toBe(3);
  });
  it("is 0 when the last candle is green", () => {
    const candles = [c(3, 2), c(2, 1), c(1, 2)];
    expect(computeTechnicals(candles, "15m").consecutive_red_count).toBe(0);
  });
  it("counts all when every candle is red", () => {
    const candles = [c(3, 2), c(2, 1), c(1, 0.5)];
    expect(computeTechnicals(candles, "15m").consecutive_red_count).toBe(3);
  });
});

describe("TechnicalsSummarySchema — backward compatibility", () => {
  it("parses a record persisted BEFORE consecutive_red_count existed (defaults to null)", async () => {
    const { TechnicalsSummarySchema } = await import("../../src/domain/schemas/kline.js");
    const legacy = {
      timeframe: "1h",
      candles: 100,
      last_close: 1,
      spike_pct: null,
      at_local_top: null,
      at_local_bottom: null,
      atr_pct: 20,
      vol_spike: null,
      trend: "UP",
      from_window_high_pct: -30,
      nearest_support: null,
      support_distance_pct: null,
      support_touches: null,
      // no consecutive_red_count — old on-disk shape
    };
    const parsed = TechnicalsSummarySchema.parse(legacy);
    expect(parsed.consecutive_red_count).toBeNull();
  });
});
