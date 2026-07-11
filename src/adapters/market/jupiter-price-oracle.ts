import { z } from "zod";
import type { Clock } from "../../ports/clock.js";
import type { Logger } from "../../ports/logger.js";
import type { PriceOracle } from "../../ports/price-oracle.js";
import { createTtlCache } from "../../shared/cache.js";

/** Wrapped-SOL mint on mainnet — Jupiter keys prices by mint address. */
export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

/** Jupiter Price API v6 base URL. */
export const DEFAULT_JUPITER_PRICE_BASE_URL = "https://price.jup.ag/v6";

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;

/** Minimum shape we care about from Jupiter's response. */
const JupiterPriceResponseSchema = z.object({
  data: z.record(
    z.object({
      price: z.union([z.number(), z.string()]).transform((v) => {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error(`invalid price: ${v}`);
        }
        return n;
      }),
    }),
  ),
});

export type FetchImpl = (input: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}>;

export interface JupiterPriceOracleOptions {
  clock: Clock;
  logger: Logger;
  /** Injected for tests. Falls back to globalThis.fetch. */
  fetchImpl?: FetchImpl;
  ttlMs?: number;
  /** Retry count in addition to the initial attempt. Default 2 → 3 attempts. */
  retries?: number;
  retryDelayMs?: number;
  baseUrl?: string;
  solMint?: string;
  /** When set, oracle returns this price if all retries fail. Without it, `getSolUsdPrice` throws. */
  fallbackUsd?: number;
  /** Injectable delay for tests to skip real timers. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Jupiter Price API adapter — fetches SOL/USD with TTL caching and retry.
 *
 * Behavior:
 *   ✓ TTL cache (default 30s) — one HTTP request per window
 *   ✓ Retry with linear delay on non-2xx / network errors
 *   ✓ Optional fallback price when all retries fail — keeps daemon alive during outages
 *   ✓ Zod-validated response — malformed body treated as failure
 *
 * The fetch impl is injected so tests can drive it deterministically without touching the network.
 */
export function createJupiterPriceOracle(opts: JupiterPriceOracleOptions): PriceOracle {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  if (typeof fetchImpl !== "function") {
    throw new Error("createJupiterPriceOracle: no fetch implementation available");
  }

  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const baseUrl = (opts.baseUrl ?? DEFAULT_JUPITER_PRICE_BASE_URL).replace(/\/+$/, "");
  const solMint = opts.solMint ?? WRAPPED_SOL_MINT;
  const sleep = opts.sleep ?? defaultSleep;
  const timeoutMs = opts.timeoutMs ?? 5_000;

  const cache = createTtlCache<number>({ ttlMs, clock: opts.clock });

  async function fetchOnce(): Promise<number> {
    const url = `${baseUrl}/price?ids=${encodeURIComponent(solMint)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Awaited<ReturnType<FetchImpl>>;
    try {
      res = await fetchImpl(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new Error(`jupiter price fetch: ${res.status} ${res.statusText}`);
    }
    const body: unknown = await res.json();
    const parsed = JupiterPriceResponseSchema.parse(body);
    const entry = parsed.data[solMint];
    if (!entry) {
      throw new Error(`jupiter price: mint ${solMint} missing from response`);
    }
    return entry.price;
  }

  async function fetchWithRetry(): Promise<number> {
    let lastErr: unknown;
    const attempts = retries + 1;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await fetchOnce();
      } catch (err) {
        lastErr = err;
        opts.logger.warn("jupiter-price", `attempt ${i + 1}/${attempts} failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
        if (i < attempts - 1) {
          await sleep(retryDelayMs * (i + 1));
        }
      }
    }
    if (opts.fallbackUsd != null && Number.isFinite(opts.fallbackUsd) && opts.fallbackUsd > 0) {
      opts.logger.error("jupiter-price", "all attempts failed, using fallback", {
        fallbackUsd: opts.fallbackUsd,
        error: lastErr instanceof Error ? lastErr.message : String(lastErr),
      });
      return opts.fallbackUsd;
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  return {
    async getSolUsdPrice(): Promise<number> {
      return cache.get(fetchWithRetry);
    },
  };
}
