import { z } from "zod";
import type { Clock } from "../../ports/clock.js";
import type { Logger } from "../../ports/logger.js";
import type { SmartWalletChecker } from "../../ports/smart-wallet-checker.js";
import type { SmartWallet } from "../../domain/schemas/smart-wallet.js";
import type { SmartWalletMatch } from "../../domain/schemas/market.js";
import type { TokenInfoClient } from "../../ports/token-info-client.js";
import { createTtlCache, type TtlCache } from "../../shared/cache.js";

export const DEFAULT_METEORA_PORTFOLIO_BASE_URL = "https://dlmm.datapi.meteora.ag/portfolio/open";
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 6_000;

export type FetchImpl = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

const PortfolioResponseSchema = z
  .object({
    pools: z
      .array(
        z
          .object({
            poolAddress: z.string(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export interface MeteoraSmartWalletCheckerOptions {
  logger: Logger;
  clock: Clock;
  /** Returns the current list of tracked smart wallets (repo-driven). */
  loadWallets: () => Promise<SmartWallet[]>;
  /** Optional — used to check base-mint holdings for `type: "holder"` wallets. */
  tokenInfo?: TokenInfoClient;
  fetchImpl?: FetchImpl;
  baseUrl?: string;
  cacheTtlMs?: number;
  timeoutMs?: number;
}

/**
 * Meteora datapi + Jupiter holders adapter for `SmartWalletChecker`.
 *
 * For each tracked wallet:
 *   - `type: "lp"` (default) → GET `/portfolio/open?user=<wallet>` and check whether the
 *     tracked pool appears in the wallet's open-position list.
 *   - `type: "holder"` → look up base-mint holders via the injected `TokenInfoClient`
 *     (Jupiter datapi) and check whether the wallet address is in the top-100 list.
 *
 * Per-wallet portfolio responses are cached for 5 min (TTL matches
 * smart-wallets.js:_cache), so a pool-vs-basemint match doesn't cost N HTTP round-trips
 * per screening tick.
 */
export function createMeteoraSmartWalletChecker(
  opts: MeteoraSmartWalletCheckerOptions,
): SmartWalletChecker {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  if (typeof fetchImpl !== "function") {
    throw new Error("createMeteoraSmartWalletChecker: no fetch implementation available");
  }
  const baseUrl = (opts.baseUrl ?? DEFAULT_METEORA_PORTFOLIO_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ttlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  const poolsCache = new Map<string, TtlCache<Set<string>>>();
  const holdersCache = new Map<string, TtlCache<Set<string>>>();

  function getPoolsCache(walletAddress: string): TtlCache<Set<string>> {
    let cache = poolsCache.get(walletAddress);
    if (!cache) {
      cache = createTtlCache<Set<string>>({ ttlMs, clock: opts.clock });
      poolsCache.set(walletAddress, cache);
    }
    return cache;
  }
  function getHoldersCache(mint: string): TtlCache<Set<string>> {
    let cache = holdersCache.get(mint);
    if (!cache) {
      cache = createTtlCache<Set<string>>({ ttlMs, clock: opts.clock });
      holdersCache.set(mint, cache);
    }
    return cache;
  }

  async function fetchWalletPools(walletAddress: string): Promise<Set<string>> {
    const url = `${baseUrl}?user=${encodeURIComponent(walletAddress)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: controller.signal });
      if (!res.ok) {
        opts.logger.warn("smart-wallets", `portfolio ${res.status} for ${walletAddress.slice(0, 8)}`, {
          status: res.status,
        });
        return new Set();
      }
      const parsed = PortfolioResponseSchema.safeParse(await res.json());
      if (!parsed.success) return new Set();
      const pools = new Set<string>();
      for (const p of parsed.data.pools ?? []) pools.add(p.poolAddress);
      return pools;
    } catch (err) {
      opts.logger.warn("smart-wallets", `portfolio fetch threw for ${walletAddress.slice(0, 8)}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return new Set();
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadHolderSet(mint: string): Promise<Set<string>> {
    if (!opts.tokenInfo) return new Set();
    return getHoldersCache(mint).get(async () => {
      const summary = await opts.tokenInfo!.getHolders(mint, 100);
      return new Set(summary.top.map((h) => h.address));
    });
  }

  return {
    async checkPool(poolAddress: string, baseMint: string | null): Promise<SmartWalletMatch[]> {
      const wallets = await opts.loadWallets();
      if (wallets.length === 0) return [];

      const lpWallets = wallets.filter((w) => (w.type ?? "lp") === "lp");
      const holderWallets = wallets.filter((w) => w.type === "holder");
      const matches: SmartWalletMatch[] = [];

      const lpChecks = lpWallets.map(async (w) => {
        const pools = await getPoolsCache(w.address).get(() => fetchWalletPools(w.address));
        if (pools.has(poolAddress)) {
          matches.push({
            name: w.name,
            address: w.address,
            category: w.category ?? null,
            type: "lp",
            matched_via: "position",
          });
        }
      });

      const holderChecks = baseMint
        ? holderWallets.map(async (w) => {
            const holders = await loadHolderSet(baseMint);
            if (holders.has(w.address)) {
              matches.push({
                name: w.name,
                address: w.address,
                category: w.category ?? null,
                type: "holder",
                matched_via: "holding",
              });
            }
          })
        : [];

      await Promise.all([...lpChecks, ...holderChecks]);
      return matches;
    },
  };
}
