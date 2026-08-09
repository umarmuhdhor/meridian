import type { KlineCandle, KlineTimeframe, TechnicalsSummary } from "../schemas/kline.js";

/**
 * Pure — turns OHLCV[] into a compact feature summary used both in the
 * screening candidate block (inline) and in the ad-hoc `mrd_get_pool_kline`
 * retrospective tool. NO network, NO clock — deterministic on input.
 *
 * Signals we compute (all cheap, closed-form):
 *   spike_pct              (last - mean_prior_N) / mean_prior_N * 100
 *   at_local_top           last within 2% of max(high[-N..])
 *   at_local_bottom        last within 2% of min(low[-N..])
 *   atr_pct                Wilder ATR(14) / last * 100
 *   vol_spike              vol[-1] / mean(vol[-N-1..-2])
 *   trend                  EMA(short) vs EMA(long) → UP | DOWN | FLAT (1% dead zone)
 *   from_window_high_pct   (last - max(high)) / max(high) * 100
 *   nearest_support        highest swing-low BELOW last close
 *   support_distance_pct   (nearest_support - last) / last * 100  (negative = support is below)
 *   support_touches        count of swing-lows within touchTolPct of nearest_support
 *
 * Every field is nullable — a short candle history (< min-required) yields nulls
 * on the fields that require more data, not a throw.
 */

export interface TechnicalsOptions {
  /** Window used for spike, local top/bottom, vol_spike. Default 20. */
  windowShort?: number;
  /** EMA long span for trend detection. Default 50. */
  emaLong?: number;
  /** EMA short span for trend detection. Default 20. */
  emaShort?: number;
  /** ATR period. Default 14. */
  atrPeriod?: number;
  /** "Local top / bottom" tolerance, as fraction of the extreme. Default 0.02 (2%). */
  extremeTolPct?: number;
  /** Swing detection: N candles either side must be strictly higher (for a swing low). Default 3. */
  swingWindow?: number;
  /** Two swing lows count as touches of the same support if within this % of each other. Default 2. */
  touchTolPct?: number;
  /** Trend dead zone: |emaShort/emaLong - 1| below this → FLAT. Default 0.01 (1%). */
  trendDeadZonePct?: number;
}

const DEFAULTS: Required<TechnicalsOptions> = {
  windowShort: 20,
  emaLong: 50,
  emaShort: 20,
  atrPeriod: 14,
  extremeTolPct: 0.02,
  swingWindow: 3,
  touchTolPct: 2,
  trendDeadZonePct: 0.01,
};

const nullable = <T,>(v: T | null | undefined): T | null => (v == null || Number.isNaN(v as unknown as number) ? null : v);

function ema(values: readonly number[], span: number): number | null {
  if (values.length < span) return null;
  const k = 2 / (span + 1);
  let e = values.slice(0, span).reduce((s, v) => s + v, 0) / span;
  for (let i = span; i < values.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    e = values[i]! * k + e * (1 - k);
  }
  return e;
}

function atr(candles: readonly KlineCandle[], period: number): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const c = candles[i]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const p = candles[i - 1]!;
    const tr = Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
    trs.push(tr);
  }
  // Wilder smoothing: seed with SMA of first `period` TRs, then EMA-ish rolling.
  let a = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    a = (a * (period - 1) + trs[i]!) / period;
  }
  return a;
}

/** Indexes of swing lows: candles where low is strictly below the `window` on each side. */
function swingLowIndices(candles: readonly KlineCandle[], window: number): number[] {
  const out: number[] = [];
  for (let i = window; i < candles.length - window; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const l = candles[i]!.l;
    let isLow = true;
    for (let j = 1; j <= window; j++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (candles[i - j]!.l <= l || candles[i + j]!.l <= l) {
        isLow = false;
        break;
      }
    }
    if (isLow) out.push(i);
  }
  return out;
}

export function computeTechnicals(
  candles: readonly KlineCandle[],
  timeframe: KlineTimeframe,
  opts: TechnicalsOptions = {},
): TechnicalsSummary {
  const o = { ...DEFAULTS, ...opts };
  const base = {
    timeframe,
    candles: candles.length,
    last_close: null as number | null,
    spike_pct: null as number | null,
    at_local_top: null as boolean | null,
    at_local_bottom: null as boolean | null,
    atr_pct: null as number | null,
    vol_spike: null as number | null,
    trend: null as "UP" | "DOWN" | "FLAT" | null,
    from_window_high_pct: null as number | null,
    nearest_support: null as number | null,
    support_distance_pct: null as number | null,
    support_touches: null as number | null,
  };
  if (candles.length === 0) return base;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const last = candles[candles.length - 1]!;
  base.last_close = last.c;

  // ── spike (last vs mean of the prior windowShort) ────────────────────────
  if (candles.length >= o.windowShort + 1) {
    const prior = candles.slice(-o.windowShort - 1, -1);
    const meanPrior = prior.reduce((s, k) => s + k.c, 0) / prior.length;
    if (meanPrior > 0) base.spike_pct = ((last.c - meanPrior) / meanPrior) * 100;
  }

  // ── local top / bottom (within extremeTolPct of extreme of last windowShort) ──
  if (candles.length >= o.windowShort) {
    const window = candles.slice(-o.windowShort);
    const maxH = Math.max(...window.map((k) => k.h));
    const minL = Math.min(...window.map((k) => k.l));
    if (maxH > 0) {
      base.at_local_top = last.c >= maxH * (1 - o.extremeTolPct);
      base.from_window_high_pct = ((last.c - maxH) / maxH) * 100;
    }
    if (minL > 0) base.at_local_bottom = last.c <= minL * (1 + o.extremeTolPct);
  }

  // ── ATR% ────────────────────────────────────────────────────────────────
  const a = atr(candles, o.atrPeriod);
  if (a != null && last.c > 0) base.atr_pct = (a / last.c) * 100;

  // ── volume spike ────────────────────────────────────────────────────────
  if (candles.length >= o.windowShort + 1) {
    const prior = candles.slice(-o.windowShort - 1, -1);
    const meanVol = prior.reduce((s, k) => s + k.v, 0) / prior.length;
    if (meanVol > 0) base.vol_spike = last.v / meanVol;
  }

  // ── trend (EMA short vs EMA long, dead-zone) ────────────────────────────
  const closes = candles.map((k) => k.c);
  const eShort = ema(closes, o.emaShort);
  const eLong = ema(closes, o.emaLong);
  if (eShort != null && eLong != null && eLong > 0) {
    const ratio = eShort / eLong - 1;
    if (Math.abs(ratio) < o.trendDeadZonePct) base.trend = "FLAT";
    else base.trend = ratio > 0 ? "UP" : "DOWN";
  }

  // ── swing-low support (nearest below current) ───────────────────────────
  const lows = swingLowIndices(candles, o.swingWindow)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    .map((i) => candles[i]!.l)
    .filter((p) => p > 0 && p < last.c);
  if (lows.length > 0) {
    lows.sort((a, b) => b - a); // highest below current first
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const support = lows[0]!;
    base.nearest_support = support;
    base.support_distance_pct = ((support - last.c) / last.c) * 100;
    base.support_touches = lows.filter(
      (p) => Math.abs((p - support) / support) * 100 <= o.touchTolPct,
    ).length;
  }

  return {
    ...base,
    last_close: nullable(base.last_close),
    spike_pct: nullable(base.spike_pct),
    atr_pct: nullable(base.atr_pct),
    vol_spike: nullable(base.vol_spike),
    from_window_high_pct: nullable(base.from_window_high_pct),
    nearest_support: nullable(base.nearest_support),
    support_distance_pct: nullable(base.support_distance_pct),
  };
}

// ── prompt formatting ─────────────────────────────────────────────────────

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "n/a";
  if (n >= 1) return `$${n.toFixed(4)}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toExponential(2)}`;
}

/** One-line summary per timeframe. Returns null if nothing meaningful to say. */
export function formatTechnicalsLine(t: TechnicalsSummary): string | null {
  if (t.candles === 0) return null;
  const parts: string[] = [];
  if (t.last_close != null) parts.push(`price=${fmtPrice(t.last_close)}`);
  if (t.trend != null) parts.push(`trend=${t.trend}`);
  if (t.spike_pct != null) parts.push(`spike=${fmtPct(t.spike_pct)}`);
  if (t.at_local_top === true) parts.push("at_local_top=YES");
  else if (t.at_local_bottom === true) parts.push("at_local_bottom=YES");
  if (t.from_window_high_pct != null) parts.push(`from_high=${fmtPct(t.from_window_high_pct)}`);
  if (t.atr_pct != null) parts.push(`atr=${fmtPct(t.atr_pct)}`);
  if (t.vol_spike != null) parts.push(`vol_x=${t.vol_spike.toFixed(1)}`);
  if (t.nearest_support != null && t.support_distance_pct != null) {
    const touches = t.support_touches != null ? ` touches=${t.support_touches}` : "";
    parts.push(`support=${fmtPrice(t.nearest_support)}(${fmtPct(t.support_distance_pct)})${touches}`);
  }
  return parts.length ? `${t.timeframe}: ${parts.join("  ")}` : null;
}

/** Multi-timeframe block, one line per timeframe. */
export function formatTechnicalsBlock(rows: readonly TechnicalsSummary[]): string | null {
  const lines = rows.map(formatTechnicalsLine).filter((l): l is string => l != null);
  return lines.length ? lines.join("\n         ") : null;
}
