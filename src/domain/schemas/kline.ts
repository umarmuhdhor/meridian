import { z } from "zod";

/** One OHLCV candle. Timestamps in unix seconds (matches GeckoTerminal + Birdeye). */
export const KlineCandleSchema = z.object({
  t: z.number().int().nonnegative(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number().nonnegative(),
});
export type KlineCandle = z.infer<typeof KlineCandleSchema>;

/** Supported timeframes. Kept small; extend when a caller needs it. */
export const KlineTimeframeSchema = z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]);
export type KlineTimeframe = z.infer<typeof KlineTimeframeSchema>;

/**
 * Feature summary derived from a KlineCandle[] — the compact shape Sage sees
 * inline in the candidate block. All fields are optional so a partial derivation
 * (short history, missing volume) still renders something useful.
 */
export const TechnicalsSummarySchema = z.object({
  timeframe: KlineTimeframeSchema,
  candles: z.number().int().nonnegative(),
  last_close: z.number().nullable(),
  /** (last close - mean of last N closes) / mean * 100. Positive = pumped, negative = dumped. */
  spike_pct: z.number().nullable(),
  /** true when last close is within 2% of the max-high of the last N candles. */
  at_local_top: z.boolean().nullable(),
  /** true when last close is within 2% of the min-low of the last N candles. */
  at_local_bottom: z.boolean().nullable(),
  /** ATR (Wilder-style, N=14) / last_close * 100. Volatility, normalized. */
  atr_pct: z.number().nullable(),
  /** last-candle volume / mean of prior N volumes. >3 = volume spike. */
  vol_spike: z.number().nullable(),
  /** UP | DOWN | FLAT, per short-vs-long EMA. */
  trend: z.enum(["UP", "DOWN", "FLAT"]).nullable(),
  /** % move from window HIGH to current close (negative when we've pulled back). */
  from_window_high_pct: z.number().nullable(),
  /** Nearest swing-low BELOW current close in this window. Absolute price. */
  nearest_support: z.number().nullable(),
  /** % gap between current and nearest_support (negative = support is below current). */
  support_distance_pct: z.number().nullable(),
  /** How many prior swing lows sit within `touchTolPct` of nearest_support (≥2 = tested). */
  support_touches: z.number().int().nonnegative().nullable(),
}).passthrough();
export type TechnicalsSummary = z.infer<typeof TechnicalsSummarySchema>;
