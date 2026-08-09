import type { KlineClient, KlineFetchOptions } from "../../ports/kline-client.js";
import type { KlineCandle, KlineTimeframe } from "../../domain/schemas/kline.js";

/**
 * In-memory fake for tests + dry-run mode. Returns empty by default (mirrors
 * the fail-open contract), or a preset series keyed by pool+timeframe.
 */
export interface FakeKlineClient extends KlineClient {
  set(poolAddress: string, timeframe: KlineTimeframe, candles: KlineCandle[]): void;
  clear(): void;
}

export function createFakeKlineClient(): FakeKlineClient {
  const store = new Map<string, KlineCandle[]>();
  const key = (p: string, tf: KlineTimeframe) => `${p}|${tf}`;
  return {
    async getKline(poolAddress: string, timeframe: KlineTimeframe, _o: KlineFetchOptions = {}) {
      return store.get(key(poolAddress, timeframe)) ?? [];
    },
    set(poolAddress: string, timeframe: KlineTimeframe, candles: KlineCandle[]) {
      store.set(key(poolAddress, timeframe), candles);
    },
    clear() {
      store.clear();
    },
  };
}
