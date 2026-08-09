import type { KlineCandle, KlineTimeframe } from "../domain/schemas/kline.js";

export interface KlineFetchOptions {
  /** Max candles requested. Adapters may return fewer if the source has less history. */
  limit?: number;
  /** Bypass any adapter-side cache. */
  force?: boolean;
}

/**
 * OHLCV source for a single Meteora pool. Adapters MUST NOT throw for a missing pool
 * or a rate-limit — resolve with an empty array so callers can fail open (screening
 * enrichment mirrors the diligence fail-open pattern).
 */
export interface KlineClient {
  getKline(
    poolAddress: string,
    timeframe: KlineTimeframe,
    opts?: KlineFetchOptions,
  ): Promise<KlineCandle[]>;
}
