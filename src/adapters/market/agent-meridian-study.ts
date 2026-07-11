import type { Logger } from "../../ports/logger.js";
import type { StudyClient } from "../../ports/study-client.js";
import {
  StudyResultSchema,
  TopLperSchema,
  TopLpersResultSchema,
  type StudyResult,
  type TopLper,
  type TopLpersResult,
} from "../../domain/schemas/study.js";

export type FetchImpl = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface AgentMeridianStudyOptions {
  logger: Logger;
  /** Base API url, e.g. https://api.agentmeridian.xyz/api */
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: FetchImpl;
}

const asLperArray = (data: unknown): TopLper[] => {
  // Accept either a bare array or { lpers: [...] } / { data: [...] }.
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { lpers?: unknown })?.lpers)
      ? (data as { lpers: unknown[] }).lpers
      : Array.isArray((data as { data?: unknown })?.data)
        ? (data as { data: unknown[] }).data
        : [];
  return arr
    .map((x) => TopLperSchema.safeParse(x))
    .filter((r): r is { success: true; data: TopLper } => r.success)
    .map((r) => r.data);
};

/** Agent Meridian /top-lp + /study-top-lp study source. Non-throwing (empty on failure). */
export function createAgentMeridianStudy(opts: AgentMeridianStudyOptions): StudyClient {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? 8_000;

  async function get(path: string): Promise<unknown> {
    if (typeof fetchImpl !== "function") return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${baseUrl}${path}`, {
        signal: controller.signal,
        headers: opts.apiKey ? { "x-api-key": opts.apiKey } : {},
      });
      if (!res.ok) {
        opts.logger.warn("study", `GET ${path} → ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      opts.logger.warn("study", `GET ${path} threw`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async getTopLpers(limit = 20): Promise<TopLpersResult> {
      const data = await get(`/top-lp?limit=${encodeURIComponent(limit)}`);
      const lpers = asLperArray(data);
      return TopLpersResultSchema.parse({ lpers, count: lpers.length });
    },
    async studyTopLpers(): Promise<StudyResult> {
      const data = await get(`/study-top-lp`);
      const lpers = asLperArray(data);
      const summary =
        typeof (data as { summary?: unknown })?.summary === "string"
          ? (data as { summary: string }).summary
          : null;
      const patternsRaw = (data as { patterns?: unknown })?.patterns;
      const patterns = Array.isArray(patternsRaw) ? patternsRaw.map((p) => String(p)) : [];
      return StudyResultSchema.parse({ lpers, summary, patterns });
    },
  };
}
