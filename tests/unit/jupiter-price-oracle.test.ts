import { describe, it, expect, vi } from "vitest";
import type { Clock } from "../../src/ports/clock.js";
import { nullLogger } from "../../src/ports/logger.js";
import {
  createJupiterPriceOracle,
  WRAPPED_SOL_MINT,
} from "../../src/adapters/market/jupiter-price-oracle.js";
import type { FetchImpl } from "../../src/adapters/market/jupiter-price-oracle.js";

function mutableClock(startIso: string): Clock & { advance(ms: number): void } {
  let ms = new Date(startIso).getTime();
  return {
    now: () => new Date(ms),
    advance: (delta: number) => {
      ms += delta;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Awaited<ReturnType<FetchImpl>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    json: async () => body,
  };
}

function priceBody(price: number, mint = WRAPPED_SOL_MINT): unknown {
  return { data: { [mint]: { id: mint, mintSymbol: "SOL", price } } };
}

describe("createJupiterPriceOracle", () => {
  it("caches within TTL, refetches after expiry", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse(priceBody(150.5)));
    const oracle = createJupiterPriceOracle({
      clock,
      logger: nullLogger,
      fetchImpl,
      ttlMs: 30_000,
      sleep: async () => {},
    });

    expect(await oracle.getSolUsdPrice()).toBe(150.5);
    expect(await oracle.getSolUsdPrice()).toBe(150.5);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clock.advance(29_999);
    expect(await oracle.getSolUsdPrice()).toBe(150.5);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clock.advance(2);
    fetchImpl.mockResolvedValueOnce(jsonResponse(priceBody(180.25)));
    expect(await oracle.getSolUsdPrice()).toBe(180.25);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries on transient failure, then succeeds", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const fetchImpl = vi.fn<FetchImpl>();
    fetchImpl
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 503))
      .mockResolvedValueOnce(jsonResponse(priceBody(142)));
    const oracle = createJupiterPriceOracle({
      clock,
      logger: nullLogger,
      fetchImpl,
      retries: 2,
      sleep: async () => {},
    });
    expect(await oracle.getSolUsdPrice()).toBe(142);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("uses fallback when all retries fail", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse({ error: "boom" }, 500));
    const oracle = createJupiterPriceOracle({
      clock,
      logger: nullLogger,
      fetchImpl,
      retries: 2,
      fallbackUsd: 175,
      sleep: async () => {},
    });
    expect(await oracle.getSolUsdPrice()).toBe(175);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("throws when all retries fail and no fallback set", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const fetchImpl = vi.fn<FetchImpl>(async () => {
      throw new Error("network down");
    });
    const oracle = createJupiterPriceOracle({
      clock,
      logger: nullLogger,
      fetchImpl,
      retries: 1,
      sleep: async () => {},
    });
    await expect(oracle.getSolUsdPrice()).rejects.toThrow(/network down/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed response body", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      jsonResponse({ unexpected: "shape" }),
    );
    const oracle = createJupiterPriceOracle({
      clock,
      logger: nullLogger,
      fetchImpl,
      retries: 0,
      sleep: async () => {},
    });
    await expect(oracle.getSolUsdPrice()).rejects.toThrow();
  });

  it("rejects when SOL mint missing from data", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      jsonResponse(priceBody(100, "SomeOtherMint")),
    );
    const oracle = createJupiterPriceOracle({
      clock,
      logger: nullLogger,
      fetchImpl,
      retries: 0,
      sleep: async () => {},
    });
    await expect(oracle.getSolUsdPrice()).rejects.toThrow(/missing from response/);
  });

  it("dedupes concurrent callers into one HTTP request", async () => {
    const clock = mutableClock("2026-07-05T12:00:00.000Z");
    let resolveFetch!: (v: Awaited<ReturnType<FetchImpl>>) => void;
    const fetchImpl = vi.fn<FetchImpl>(
      () =>
        new Promise<Awaited<ReturnType<FetchImpl>>>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const oracle = createJupiterPriceOracle({
      clock,
      logger: nullLogger,
      fetchImpl,
      sleep: async () => {},
    });
    const p1 = oracle.getSolUsdPrice();
    const p2 = oracle.getSolUsdPrice();
    const p3 = oracle.getSolUsdPrice();
    resolveFetch(jsonResponse(priceBody(120)));
    expect(await Promise.all([p1, p2, p3])).toEqual([120, 120, 120]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
