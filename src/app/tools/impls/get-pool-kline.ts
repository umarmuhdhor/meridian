import { z } from "zod";
import { defineTool } from "../define-tool.js";
import {
  KlineCandleSchema,
  KlineTimeframeSchema,
  TechnicalsSummarySchema,
} from "../../../domain/schemas/kline.js";
import { computeTechnicals, formatTechnicalsLine } from "../../../domain/format/technicals.js";

/**
 * Fetch OHLCV for a Meteora pool + compute the technical-analysis summary.
 * Read-only, safe for the dashboard chat surface. Bridge-exposed so Sage
 * (Hermes) can call it via mrd_get_pool_kline for interactive analysis
 * (retrospectives, "was that entry near support?", etc.).
 *
 * Multi-timeframe by default: fetches every requested timeframe in parallel and
 * returns per-timeframe technicals PLUS a compact `formatted` string that
 * exactly matches the shape screening injects inline (so Sage sees consistent
 * output across the two entry points).
 *
 * Fails open per timeframe — a rate-limit or missing pool for one timeframe
 * yields an empty candles[] and null features, never blocks the others.
 */
export const getPoolKlineTool = defineTool({
  name: "get_pool_kline",
  description:
    "Fetch OHLCV + computed technicals for a Meteora pool (spike, at_local_top, atr, vol_spike, trend, support proximity). Multi-timeframe. Use for retrospectives (\"was our entry at a spike top?\") and to sanity-check a candidate outside screening.",
  args: z.object({
    pool_address: z.string().min(1),
    /** One or more timeframes. Default 5m + 1h — same pair screening pre-fetches. */
    timeframes: z.array(KlineTimeframeSchema).min(1).max(6).default(["5m", "1h"]),
    /** Candle count per timeframe (1-500, default 100). More = deeper support/trend but larger payload. */
    limit: z.number().int().min(1).max(500).default(100),
  }),
  result: z.object({
    pool_address: z.string(),
    timeframes: z.array(
      z.object({
        timeframe: KlineTimeframeSchema,
        candles: z.array(KlineCandleSchema),
        technicals: TechnicalsSummarySchema,
      }),
    ),
    formatted: z.string(),
  }),
  execute: async ({ pool_address, timeframes, limit }, ctx) => {
    const rows = await Promise.all(
      timeframes.map(async (tf) => {
        const candles = await ctx.market.kline
          .getKline(pool_address, tf, { limit })
          .catch(() => []);
        const technicals = computeTechnicals(candles, tf);
        return { timeframe: tf, candles, technicals };
      }),
    );
    const lines = rows
      .map((r) => formatTechnicalsLine(r.technicals))
      .filter((l): l is string => l != null);
    return {
      pool_address,
      timeframes: rows,
      formatted: lines.length ? lines.join("\n") : "no technicals available",
    };
  },
});
