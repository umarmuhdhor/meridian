import { z } from "zod";
import type { Logger } from "../../ports/logger.js";
import type { RugCheckClient } from "../../ports/rug-check.js";
import type { RugCheckResult } from "../../domain/schemas/market.js";

export const DEFAULT_RUGCHECK_BASE_URL = "https://api.rugcheck.xyz/v1";
const DEFAULT_TIMEOUT_MS = 10_000;

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

const RugcheckReportSchema = z
  .object({
    rugged: z.boolean().optional(),
    score: z.union([z.number(), z.string()]).optional(),
    topHolders: z
      .array(
        z
          .object({
            pct: z.union([z.number(), z.string()]).optional(),
            percentage: z.union([z.number(), z.string()]).optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export interface RugcheckAdapterOptions {
  logger: Logger;
  fetchImpl?: FetchImpl;
  baseUrl?: string;
  timeoutMs?: number;
  /** Max rugcheck score before rejecting. Mirrors discord-listener/pre-checks.js. */
  scoreCeiling?: number;
  /** Max top-10 holder concentration % before rejecting. */
  top10Ceiling?: number;
  /** When rugcheck API is unreachable / errors, pass by default (matches JS behavior). */
  passOnError?: boolean;
}

const DEFAULT_SCORE_CEILING = 50_000;
const DEFAULT_TOP10_CEILING = 60;

/**
 * rugcheck.xyz adapter — mirrors the same gate logic as discord-listener/pre-checks.js:89.
 *
 *   ✗ rugged=true                      → fail
 *   ✗ score > scoreCeiling (50k)       → fail
 *   ✗ sum(top10.pct) > top10Ceiling    → fail
 *   ✓ otherwise                        → pass
 *   ✓ API error + passOnError=true     → pass (default — matches JS "don't block on outage")
 */
export function createRugcheckAdapter(opts: RugcheckAdapterOptions): RugCheckClient {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  if (typeof fetchImpl !== "function") {
    throw new Error("createRugcheckAdapter: no fetch implementation available");
  }
  const baseUrl = (opts.baseUrl ?? DEFAULT_RUGCHECK_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const scoreCeiling = opts.scoreCeiling ?? DEFAULT_SCORE_CEILING;
  const top10Ceiling = opts.top10Ceiling ?? DEFAULT_TOP10_CEILING;
  const passOnError = opts.passOnError ?? true;

  function apiUnavailable(mint: string, reason: string): RugCheckResult {
    opts.logger.warn("rugcheck", `API unavailable for ${mint.slice(0, 6)}…`, { reason });
    return {
      mint,
      score: 0,
      top10_pct: 0,
      passes: passOnError,
      reason: passOnError ? null : `rugcheck: API unavailable (${reason})`,
    };
  }

  return {
    async check(mint: string): Promise<RugCheckResult> {
      if (!mint) return { mint, score: 0, top10_pct: 0, passes: true, reason: null };
      const url = `${baseUrl}/tokens/${encodeURIComponent(mint)}/report`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let body: unknown;
      try {
        const res = await fetchImpl(url, { signal: controller.signal });
        if (!res.ok) {
          clearTimeout(timer);
          return apiUnavailable(mint, `${res.status} ${res.statusText}`);
        }
        body = await res.json();
      } catch (err) {
        clearTimeout(timer);
        return apiUnavailable(mint, err instanceof Error ? err.message : String(err));
      } finally {
        clearTimeout(timer);
      }
      const parsed = RugcheckReportSchema.safeParse(body);
      if (!parsed.success) {
        return apiUnavailable(mint, "malformed report body");
      }
      const data = parsed.data;
      if (data.rugged === true) {
        return { mint, score: 0, top10_pct: 0, passes: false, reason: "rugcheck: token is rugged" };
      }
      const score = num(data.score) ?? 0;
      if (score > scoreCeiling) {
        return {
          mint,
          score,
          top10_pct: 0,
          passes: false,
          reason: `rugcheck: score too high (${score})`,
        };
      }
      const top10Pct = (data.topHolders ?? [])
        .slice(0, 10)
        .reduce<number>((sum, h) => sum + (num(h.pct) ?? num(h.percentage) ?? 0), 0);
      if (top10Pct > top10Ceiling) {
        return {
          mint,
          score,
          top10_pct: top10Pct,
          passes: false,
          reason: `rugcheck: top10 holders ${top10Pct.toFixed(1)}% > ${top10Ceiling}%`,
        };
      }
      return { mint, score, top10_pct: top10Pct, passes: true, reason: null };
    },
  };
}
