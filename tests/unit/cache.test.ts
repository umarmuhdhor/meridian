import { describe, it, expect } from "vitest";
import { createTtlCache } from "../../src/shared/cache.js";
import type { Clock } from "../../src/ports/clock.js";

function mutableClock(startIso: string): Clock & { advance(ms: number): void } {
  let ms = new Date(startIso).getTime();
  return {
    now: () => new Date(ms),
    advance: (delta: number) => {
      ms += delta;
    },
  };
}

describe("TtlCache", () => {
  it("caches within TTL, refetches after expiry", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const cache = createTtlCache<number>({ ttlMs: 1000, clock });
    let calls = 0;
    const loader = async () => ++calls;

    expect(await cache.get(loader)).toBe(1);
    expect(await cache.get(loader)).toBe(1);
    clock.advance(999);
    expect(await cache.get(loader)).toBe(1);
    clock.advance(2);
    expect(await cache.get(loader)).toBe(2);
  });

  it("force bypasses cache", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const cache = createTtlCache<number>({ ttlMs: 60_000, clock });
    let calls = 0;
    const loader = async () => ++calls;

    expect(await cache.get(loader)).toBe(1);
    expect(await cache.get(loader, true)).toBe(2);
    expect(await cache.get(loader)).toBe(2);
  });

  it("dedupes concurrent callers into one loader invocation", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const cache = createTtlCache<number>({ ttlMs: 60_000, clock });
    let calls = 0;
    let resolveFirst!: (n: number) => void;
    const loader = () => {
      calls += 1;
      return new Promise<number>((resolve) => {
        resolveFirst = resolve;
      });
    };
    const p1 = cache.get(loader);
    const p2 = cache.get(loader);
    const p3 = cache.get(loader);
    resolveFirst(42);
    const results = await Promise.all([p1, p2, p3]);
    expect(results).toEqual([42, 42, 42]);
    expect(calls).toBe(1);
  });

  it("invalidate forces a refetch on next get", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const cache = createTtlCache<number>({ ttlMs: 60_000, clock });
    let calls = 0;
    const loader = async () => ++calls;

    await cache.get(loader);
    cache.invalidate();
    expect(cache.peek()).toBeNull();
    expect(await cache.get(loader)).toBe(2);
  });

  it("peek returns value + age, null when empty", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const cache = createTtlCache<string>({ ttlMs: 60_000, clock });
    expect(cache.peek()).toBeNull();
    await cache.get(async () => "x");
    clock.advance(500);
    const peek = cache.peek();
    expect(peek?.value).toBe("x");
    expect(peek?.ageMs).toBe(500);
  });
});
