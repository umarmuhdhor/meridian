import type { Clock } from "../ports/clock.js";

export interface TtlCacheOptions {
  ttlMs: number;
  clock: Clock;
}

/**
 * Single-slot TTL cache with inflight dedup — mirrors the `_positionsCache` +
 * `_positionsCacheAt` + `_positionsInflight` triplet in tools/dlmm.js:1154.
 *
 * - `get(force?)` returns the cached value if fresh, else calls `loader` once
 *   (concurrent callers await the same promise). `force: true` bypasses the cache.
 * - `invalidate()` drops the cached value; the next `get` refetches.
 * - Clock injected so tests can advance time without real timers.
 */
export interface TtlCache<T> {
  get(loader: () => Promise<T>, force?: boolean): Promise<T>;
  invalidate(): void;
  peek(): { value: T; ageMs: number } | null;
}

export function createTtlCache<T>(opts: TtlCacheOptions): TtlCache<T> {
  let value: T | undefined;
  let fetchedAt: number | null = null;
  let inflight: Promise<T> | null = null;

  const isFresh = (): boolean => {
    if (value === undefined || fetchedAt == null) return false;
    return opts.clock.now().getTime() - fetchedAt < opts.ttlMs;
  };

  return {
    async get(loader, force = false) {
      if (!force && isFresh()) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return value as T;
      }
      if (inflight && !force) return inflight;
      inflight = (async () => {
        try {
          const next = await loader();
          value = next;
          fetchedAt = opts.clock.now().getTime();
          return next;
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    },
    invalidate() {
      value = undefined;
      fetchedAt = null;
    },
    peek() {
      if (value === undefined || fetchedAt == null) return null;
      return { value, ageMs: opts.clock.now().getTime() - fetchedAt };
    },
  };
}
