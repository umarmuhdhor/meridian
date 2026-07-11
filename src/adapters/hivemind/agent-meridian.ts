import { z } from "zod";
import type { Clock } from "../../ports/clock.js";
import type { Logger } from "../../ports/logger.js";
import type { Lesson, PerformanceRecord } from "../../domain/schemas/lesson.js";
import type {
  HiveMindClient,
  HiveMindPushResult,
  SharedLesson,
  SharedPreset,
} from "../../ports/hivemind.js";

export const DEFAULT_HIVEMIND_BASE_URL = "https://api.agentmeridian.xyz";
const DEFAULT_TIMEOUT_MS = 8_000;

export type FetchImpl = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

const LessonPullSchema = z
  .object({
    lessons: z
      .array(
        z
          .object({
            id: z.string(),
            rule: z.string(),
            score: z.union([z.number(), z.string()]).nullable().optional(),
            tags: z.array(z.string()).optional(),
            source_agent_id: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const PresetPullSchema = z
  .object({
    presets: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            data: z.record(z.string(), z.unknown()).default({}),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export interface AgentMeridianHiveMindOptions {
  logger: Logger;
  clock: Clock;
  enabled: boolean;
  agentId: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: FetchImpl;
  version?: string;
  capabilities?: () => Record<string, unknown>;
}

/**
 * Agent Meridian HiveMind adapter — fire-and-forget push, defensive pull.
 *
 * Every method is non-throwing: adapters that fail on the wire log a warn and return
 * a null / error result. The caller decides whether to fall back to local state.
 *
 * `isEnabled()` returns false when the caller flag is off OR the API key + agent id
 * combo is unusable; the client shortcuts every RPC in that case.
 */
export function createAgentMeridianHiveMind(
  opts: AgentMeridianHiveMindOptions,
): HiveMindClient {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
  if (typeof fetchImpl !== "function") {
    throw new Error("createAgentMeridianHiveMind: no fetch implementation available");
  }
  const baseUrl = (opts.baseUrl ?? DEFAULT_HIVEMIND_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const isEnabled = (): boolean => opts.enabled && !!opts.agentId;

  async function request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, string | number>,
  ): Promise<{ ok: boolean; data: unknown; status: number }> {
    const url = new URL(`${baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const init: {
        method: string;
        headers: Record<string, string>;
        body?: string;
        signal: AbortSignal;
      } = {
        method,
        headers: {
          "content-type": "application/json",
          ...(opts.apiKey ? { "x-api-key": opts.apiKey } : {}),
        },
        signal: controller.signal,
      };
      if (body) init.body = JSON.stringify(body);
      const res = await fetchImpl(url.toString(), init);
      const data = await res.json().catch(() => null);
      return { ok: res.ok, data, status: res.status };
    } catch (err) {
      opts.logger.warn("hivemind", `${method} ${path} threw`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, data: null, status: 0 };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    isEnabled,
    agentId: () => opts.agentId,

    async registerAgent(reason = "heartbeat"): Promise<void> {
      if (!isEnabled()) return;
      const res = await request("POST", "/api/hivemind/agents/register", {
        agentId: opts.agentId,
        version: opts.version ?? "meridian-ts",
        timestamp: opts.clock.now().toISOString(),
        reason,
        capabilities: opts.capabilities ? opts.capabilities() : {},
      });
      if (!res.ok) {
        opts.logger.warn("hivemind", "register failed", { status: res.status });
      }
    },

    async pushLesson(lesson: Lesson): Promise<HiveMindPushResult> {
      if (!isEnabled()) return { ok: false, reason: "disabled" };
      const res = await request("POST", "/api/hivemind/lessons/push", {
        agentId: opts.agentId,
        lesson,
      });
      if (!res.ok) {
        opts.logger.warn("hivemind", "lesson push failed", { status: res.status });
        return { ok: false, reason: `status ${res.status}` };
      }
      return { ok: true };
    },

    async pushPerformance(perf: PerformanceRecord): Promise<HiveMindPushResult> {
      if (!isEnabled()) return { ok: false, reason: "disabled" };
      const res = await request("POST", "/api/hivemind/performance/push", {
        agentId: opts.agentId,
        performance: perf,
      });
      if (!res.ok) {
        opts.logger.warn("hivemind", "performance push failed", { status: res.status });
        return { ok: false, reason: `status ${res.status}` };
      }
      return { ok: true };
    },

    async pullLessons(limit = 12): Promise<SharedLesson[] | null> {
      if (!isEnabled()) return null;
      const res = await request(
        "GET",
        "/api/hivemind/lessons/pull",
        undefined,
        { agentId: opts.agentId, limit },
      );
      if (!res.ok) {
        opts.logger.warn("hivemind", "lesson pull failed", { status: res.status });
        return null;
      }
      const parsed = LessonPullSchema.safeParse(res.data);
      if (!parsed.success) return [];
      return (parsed.data.lessons ?? []).map((l) => ({
        id: l.id,
        rule: l.rule,
        score: l.score != null ? Number(l.score) : null,
        tags: l.tags ?? [],
        source_agent_id: l.source_agent_id ?? null,
      }));
    },

    async pullPresets(): Promise<SharedPreset[] | null> {
      if (!isEnabled()) return null;
      const res = await request(
        "GET",
        "/api/hivemind/presets/pull",
        undefined,
        { agentId: opts.agentId },
      );
      if (!res.ok) {
        opts.logger.warn("hivemind", "preset pull failed", { status: res.status });
        return null;
      }
      const parsed = PresetPullSchema.safeParse(res.data);
      if (!parsed.success) return [];
      return parsed.data.presets ?? [];
    },
  };
}
