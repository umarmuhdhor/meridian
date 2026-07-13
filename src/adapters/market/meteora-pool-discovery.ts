import { z } from "zod";
import type { Logger } from "../../ports/logger.js";
import type {
  DiscoverOptions,
  PoolDiscoveryClient,
} from "../../ports/pool-discovery.js";
import type { ScreeningConfig } from "../../domain/schemas/config.js";
import type { CandidatePool } from "../../domain/schemas/market.js";
import { CandidatePoolSchema } from "../../domain/schemas/market.js";

export const DEFAULT_POOL_DISCOVERY_BASE_URL =
  "https://pool-discovery-api.datapi.meteora.ag";
export const DEFAULT_METEORA_SEARCH_BASE_URL =
  "https://dlmm.datapi.meteora.ag";

const DEFAULT_TIMEOUT_MS = 8_000;

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

// Meteora datapi (2026-07) nests token + DLMM fields under `token_x`/`token_y`/
// `dlmm_params`. Older shapes used flat `base_token_*` / `dlmm_bin_step` keys.
// normalize() reads nested-first, flat-fallback, so both response generations work.
const RawTokenSchema = z
  .object({
    address: z.string().optional(),
    organic_score: z.union([z.number(), z.string()]).optional(),
    holders: z.union([z.number(), z.string()]).optional(),
    market_cap: z.union([z.number(), z.string()]).optional(),
    created_at: z.union([z.number(), z.string()]).nullable().optional(),
  })
  .passthrough();

const RawPoolSchema = z
  .object({
    pool_address: z.string().optional(),
    // The search endpoint (/pools?query=) names the pool id `address`; the filter
    // endpoint uses `pool_address`. Accept both or search_pools yields 0 results.
    address: z.string().optional(),
    name: z.string().optional(),
    token_x: RawTokenSchema.optional(),
    token_y: RawTokenSchema.optional(),
    dlmm_params: z
      .object({ bin_step: z.union([z.number(), z.string()]).optional() })
      .passthrough()
      .optional(),
    active_positions_pct: z.union([z.number(), z.string()]).nullable().optional(),
    base_token_mint: z.string().optional(),
    quote_token_mint: z.string().optional(),
    base_mint: z.string().optional(),
    quote_mint: z.string().optional(),
    tvl: z.union([z.number(), z.string()]).optional(),
    active_tvl: z.union([z.number(), z.string()]).optional(),
    volume: z.union([z.number(), z.string()]).optional(),
    volume_window: z.union([z.number(), z.string()]).optional(),
    fee_active_tvl_ratio: z.union([z.number(), z.string()]).optional(),
    fee_tvl_ratio: z.union([z.number(), z.string()]).optional(),
    base_token_organic_score: z.union([z.number(), z.string()]).optional(),
    organic_score: z.union([z.number(), z.string()]).optional(),
    base_token_holders: z.union([z.number(), z.string()]).optional(),
    holders: z.union([z.number(), z.string()]).optional(),
    base_token_market_cap: z.union([z.number(), z.string()]).optional(),
    mcap: z.union([z.number(), z.string()]).optional(),
    dlmm_bin_step: z.union([z.number(), z.string()]).optional(),
    bin_step: z.union([z.number(), z.string()]).optional(),
    volatility: z.union([z.number(), z.string()]).optional(),
    base_token_launchpad: z.string().nullable().optional(),
    launchpad: z.string().nullable().optional(),
    base_token_created_at: z.union([z.number(), z.string()]).nullable().optional(),
    token_age_hours: z.union([z.number(), z.string()]).nullable().optional(),
    active_pct: z.union([z.number(), z.string()]).nullable().optional(),
  })
  .passthrough();

const DiscoveryResponseSchema = z.object({
  data: z.array(RawPoolSchema).optional(),
});

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function numOrNull(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : n;
}

function ageHoursFromCreatedAt(v: unknown, nowMs: number): number | null {
  const created = num(v);
  if (created == null || created <= 0) return null;
  // Some endpoints return ms epoch, others seconds. Detect via magnitude.
  const ms = created > 1e12 ? created : created * 1000;
  const diffMs = nowMs - ms;
  if (diffMs < 0) return null;
  return diffMs / 3_600_000;
}

export interface MeteoraPoolDiscoveryOptions {
  logger: Logger;
  screening: ScreeningConfig;
  now: () => Date;
  fetchImpl?: FetchImpl;
  baseUrl?: string;
  searchBaseUrl?: string;
  timeoutMs?: number;
}

/**
 * Meteora pool-discovery adapter — hits `pool-discovery-api.datapi.meteora.ag/pools` with
 * the same `filter_by` DSL the JS `discoverPools` in tools/screening.js:433 builds. Filters
 * are constructed from the injected `screening` config so hard-filter values live in one
 * place (Zod-validated config).
 *
 * Response rows are shape-normalized into `CandidatePool` — the datapi uses `base_token_*`
 * prefixes; the domain schema uses shorter names.
 */
export function createMeteoraPoolDiscovery(
  opts: MeteoraPoolDiscoveryOptions,
): PoolDiscoveryClient {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  if (typeof fetchImpl !== "function") {
    throw new Error("createMeteoraPoolDiscovery: no fetch implementation available");
  }
  const baseUrl = (opts.baseUrl ?? DEFAULT_POOL_DISCOVERY_BASE_URL).replace(/\/+$/, "");
  const searchBaseUrl = (opts.searchBaseUrl ?? DEFAULT_METEORA_SEARCH_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`meteora pool-discovery ${res.status} ${res.statusText}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function buildFilters(): string {
    const s = opts.screening;
    const nowMs = opts.now().getTime();
    const parts: (string | null)[] = [
      "base_token_has_critical_warnings=false",
      "quote_token_has_critical_warnings=false",
      s.excludeHighSupplyConcentration
        ? "base_token_has_high_supply_concentration=false"
        : null,
      "base_token_has_high_single_ownership=false",
      "pool_type=dlmm",
      `base_token_market_cap>=${s.minMcap}`,
      `base_token_market_cap<=${s.maxMcap}`,
      `base_token_holders>=${s.minHolders}`,
      `volume>=${s.minVolume}`,
      `tvl>=${s.minTvl}`,
      s.maxTvl != null ? `tvl<=${s.maxTvl}` : null,
      `dlmm_bin_step>=${s.minBinStep}`,
      `dlmm_bin_step<=${s.maxBinStep}`,
      `fee_active_tvl_ratio>=${s.minFeeActiveTvlRatio}`,
      `base_token_organic_score>=${s.minOrganic}`,
      `quote_token_organic_score>=${s.minQuoteOrganic}`,
      s.minTokenAgeHours != null
        ? `base_token_created_at<=${nowMs - s.minTokenAgeHours * 3_600_000}`
        : null,
      s.maxTokenAgeHours != null
        ? `base_token_created_at>=${nowMs - s.maxTokenAgeHours * 3_600_000}`
        : null,
      s.allowedLaunchpads.length > 0
        ? `base_token_launchpad=[${s.allowedLaunchpads.join(",")}]`
        : null,
    ];
    return parts.filter((x): x is string => x !== null).join("&&");
  }

  function normalize(raw: z.infer<typeof RawPoolSchema>): CandidatePool | null {
    // Resolve each field nested-first (current datapi), then flat (legacy shape).
    const baseMint = raw.token_x?.address ?? raw.base_token_mint ?? raw.base_mint;
    const quoteMint = raw.token_y?.address ?? raw.quote_token_mint ?? raw.quote_mint;
    const poolAddress = raw.pool_address ?? raw.address;
    if (!baseMint || !poolAddress) return null;
    const nowMs = opts.now().getTime();
    const createdAt = raw.token_x?.created_at ?? raw.base_token_created_at;
    const parsed = CandidatePoolSchema.safeParse({
      pool_address: poolAddress,
      name: raw.name ?? `${baseMint.slice(0, 4)}/${(quoteMint ?? "?").slice(0, 4)}`,
      base_mint: baseMint,
      quote_mint: quoteMint ?? "So11111111111111111111111111111111111111112",
      tvl: num(raw.tvl) ?? 0,
      active_tvl: num(raw.active_tvl),
      volume_window: num(raw.volume_window) ?? num(raw.volume) ?? 0,
      fee_active_tvl_ratio: num(raw.fee_active_tvl_ratio),
      fee_tvl_ratio: num(raw.fee_tvl_ratio),
      organic_score:
        num(raw.token_x?.organic_score) ??
        num(raw.base_token_organic_score) ??
        num(raw.organic_score),
      holders: num(raw.base_token_holders) ?? num(raw.token_x?.holders) ?? num(raw.holders),
      mcap: num(raw.token_x?.market_cap) ?? num(raw.base_token_market_cap) ?? num(raw.mcap),
      bin_step: num(raw.dlmm_params?.bin_step) ?? num(raw.dlmm_bin_step) ?? num(raw.bin_step),
      volatility: num(raw.volatility),
      launchpad: raw.base_token_launchpad ?? raw.launchpad ?? null,
      token_age_hours: ageHoursFromCreatedAt(createdAt, nowMs) ?? numOrNull(raw.token_age_hours),
      active_pct: numOrNull(raw.active_pct) ?? numOrNull(raw.active_positions_pct),
    });
    if (!parsed.success) {
      opts.logger.warn("meteora-discovery", `normalize failed for ${poolAddress.slice(0, 8)}`, {
        issues: parsed.error.issues.map((i) => i.message),
      });
      return null;
    }
    return parsed.data;
  }

  async function discoveryPage(limit: number, filters: string): Promise<CandidatePool[]> {
    const url =
      `${baseUrl}/pools?` +
      `page_size=${limit}` +
      `&filter_by=${encodeURIComponent(filters)}` +
      `&timeframe=${encodeURIComponent(opts.screening.timeframe)}` +
      `&category=${encodeURIComponent(opts.screening.category)}`;
    const parsed = DiscoveryResponseSchema.safeParse(await fetchJson(url));
    if (!parsed.success) {
      opts.logger.warn("meteora-discovery", "malformed response", {
        issues: parsed.error.issues.map((i) => i.message),
      });
      return [];
    }
    const rows = parsed.data.data ?? [];
    return rows.map(normalize).filter((p): p is CandidatePool => p !== null);
  }

  return {
    async discover(o: DiscoverOptions = {}): Promise<CandidatePool[]> {
      const limit = o.limit ?? 50;
      const filters = buildFilters();
      return discoveryPage(limit, filters);
    },
    async search(query: string, limit = 20): Promise<CandidatePool[]> {
      const url = `${searchBaseUrl}/pools?query=${encodeURIComponent(query)}`;
      const raw = await fetchJson(url).catch((err) => {
        opts.logger.warn("meteora-discovery", "search failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      });
      const parsed = DiscoveryResponseSchema.safeParse(raw ?? {});
      if (!parsed.success) return [];
      const rows = parsed.data.data ?? [];
      return rows
        .slice(0, limit)
        .map(normalize)
        .filter((p): p is CandidatePool => p !== null);
    },
    async getPoolDetail(poolAddress: string): Promise<CandidatePool | null> {
      const url =
        `${baseUrl}/pools?` +
        `page_size=1&filter_by=${encodeURIComponent(`pool_address=${poolAddress}`)}` +
        `&timeframe=${encodeURIComponent(opts.screening.timeframe)}`;
      const parsed = DiscoveryResponseSchema.safeParse(await fetchJson(url));
      if (!parsed.success) return null;
      const first = parsed.data.data?.[0];
      return first ? normalize(first) : null;
    },
  };
}
