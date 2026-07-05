import { z } from "zod";
import type { Logger } from "../../ports/logger.js";
import type { TokenInfoClient } from "../../ports/token-info-client.js";
import type {
  TokenHolder,
  TokenHoldersSummary,
  TokenInfo,
  TokenNarrative,
} from "../../domain/schemas/market.js";

export const DEFAULT_JUPITER_DATAPI_BASE_URL = "https://datapi.jup.ag/v1";

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

const JupiterAssetSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable().optional(),
    symbol: z.string().nullable().optional(),
    mcap: z.union([z.number(), z.string()]).nullable().optional(),
    usdPrice: z.union([z.number(), z.string()]).nullable().optional(),
    liquidity: z.union([z.number(), z.string()]).nullable().optional(),
    holderCount: z.union([z.number(), z.string()]).nullable().optional(),
    organicScore: z.union([z.number(), z.string()]).nullable().optional(),
    launchpad: z.string().nullable().optional(),
    dev: z.string().nullable().optional(),
    totalSupply: z.union([z.number(), z.string()]).nullable().optional(),
    circSupply: z.union([z.number(), z.string()]).nullable().optional(),
    createdAt: z.union([z.number(), z.string()]).nullable().optional(),
  })
  .passthrough();

const NarrativeResponseSchema = z
  .object({
    narrative: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    status: z.string().optional(),
  })
  .passthrough();

const HolderRowSchema = z
  .object({
    owner: z.string().optional(),
    address: z.string().optional(),
    holder: z.string().optional(),
    percent: z.union([z.number(), z.string()]).nullable().optional(),
    pct: z.union([z.number(), z.string()]).nullable().optional(),
    percentage: z.union([z.number(), z.string()]).nullable().optional(),
    amount: z.union([z.number(), z.string()]).nullable().optional(),
    label: z.string().nullable().optional(),
    tag: z.string().nullable().optional(),
  })
  .passthrough();

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function nullableNum(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : n;
}

function ageHoursFromCreatedAt(v: unknown, nowMs: number): number | null {
  const n = num(v);
  if (n == null || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  const diffMs = nowMs - ms;
  if (diffMs < 0) return null;
  return diffMs / 3_600_000;
}

export interface JupiterTokenInfoOptions {
  logger: Logger;
  now: () => Date;
  fetchImpl?: FetchImpl;
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Jupiter datapi v1 token-info adapter.
 *   - `getInfo(mint)` → `/assets/search?query=<mint>` (top result).
 *   - `getHolders(mint)` → `/holders/<mint>?limit=100` — returns count + top10 + top by pct.
 *   - `getNarrative(mint)` → `/chaininsight/narrative/<mint>` (Jupiter ChainInsight).
 *
 * All parsers are Zod-defensive: shape drift returns a minimal object (mint + nulls),
 * not a throw — the calling stage treats missing info as "unknown".
 */
export function createJupiterTokenInfo(opts: JupiterTokenInfoOptions): TokenInfoClient {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  if (typeof fetchImpl !== "function") {
    throw new Error("createJupiterTokenInfo: no fetch implementation available");
  }
  const baseUrl = (opts.baseUrl ?? DEFAULT_JUPITER_DATAPI_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`jupiter datapi ${res.status} ${res.statusText}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async getInfo(mint: string): Promise<TokenInfo> {
      const url = `${baseUrl}/assets/search?query=${encodeURIComponent(mint)}`;
      const raw = await fetchJson(url).catch((err) => {
        opts.logger.warn("jupiter-token-info", `getInfo failed for ${mint.slice(0, 6)}…`, {
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      });
      const rows = Array.isArray(raw) ? raw : [raw];
      const first = rows[0];
      const parsed = JupiterAssetSchema.safeParse(first);
      const nowMs = opts.now().getTime();
      if (!parsed.success) {
        return {
          mint,
          symbol: null,
          name: null,
          launchpad: null,
          deployer: null,
          supply: null,
          mcap: null,
          holders: null,
          age_hours: null,
        };
      }
      const a = parsed.data;
      return {
        mint: a.id,
        symbol: a.symbol ?? null,
        name: a.name ?? null,
        launchpad: a.launchpad ?? null,
        deployer: a.dev ?? null,
        supply: nullableNum(a.totalSupply ?? a.circSupply),
        mcap: nullableNum(a.mcap),
        holders: nullableNum(a.holderCount),
        age_hours: ageHoursFromCreatedAt(a.createdAt, nowMs),
      };
    },

    async getHolders(mint: string, limit = 100): Promise<TokenHoldersSummary> {
      const url = `${baseUrl}/holders/${encodeURIComponent(mint)}?limit=${limit}`;
      const raw = await fetchJson(url).catch((err) => {
        opts.logger.warn("jupiter-token-info", `getHolders failed for ${mint.slice(0, 6)}…`, {
          error: err instanceof Error ? err.message : String(err),
        });
        return { holders: [] };
      });
      const container = raw as { holders?: unknown; data?: unknown };
      const rowsRaw = Array.isArray(raw)
        ? raw
        : Array.isArray(container?.holders)
          ? container.holders
          : Array.isArray(container?.data)
            ? container.data
            : [];
      const holders: TokenHolder[] = [];
      let top10Pct = 0;
      let botPct = 0;
      for (const [idx, row] of rowsRaw.entries()) {
        const parsed = HolderRowSchema.safeParse(row);
        if (!parsed.success) continue;
        const r = parsed.data;
        const pctRaw = r.percent ?? r.pct ?? r.percentage;
        const pct = num(pctRaw);
        if (pct == null) continue;
        const address = r.owner ?? r.address ?? r.holder ?? "";
        if (!address) continue;
        const holder: TokenHolder = {
          address,
          pct,
          label: r.label ?? r.tag ?? null,
        };
        const amt = num(r.amount);
        if (amt != null) holder.amount = amt;
        holders.push(holder);
        if (idx < 10) top10Pct += pct;
        if (holder.label && /bot/i.test(holder.label)) botPct += pct;
      }
      return {
        mint,
        count: holders.length,
        top10_pct: top10Pct,
        bot_pct: botPct,
        top: holders.slice(0, 20),
      };
    },

    async getNarrative(mint: string): Promise<TokenNarrative> {
      const url = `${baseUrl}/chaininsight/narrative/${encodeURIComponent(mint)}`;
      const raw = await fetchJson(url).catch((err) => {
        opts.logger.warn("jupiter-token-info", `getNarrative failed for ${mint.slice(0, 6)}…`, {
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      });
      const parsed = NarrativeResponseSchema.safeParse(raw);
      if (!parsed.success) {
        return { mint, narrative: null, tags: [] };
      }
      return {
        mint,
        narrative: parsed.data.narrative ?? null,
        tags: parsed.data.tags ?? [],
      };
    },
  };
}
