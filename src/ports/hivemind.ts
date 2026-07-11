import type { Lesson, PerformanceRecord } from "../domain/schemas/lesson.js";

export interface SharedLesson {
  id: string;
  rule: string;
  score?: number | null;
  tags?: string[];
  source_agent_id?: string | null;
}

export interface SharedPreset {
  id: string;
  name: string;
  data: Record<string, unknown>;
}

export interface HiveMindPushResult {
  ok: boolean;
  reason?: string;
}

/**
 * Fire-and-forget bidirectional sync port with Agent Meridian.
 *
 *   - `registerAgent` sends a heartbeat (startup + interval).
 *   - `pushLesson` + `pushPerformance` are best-effort; failures never propagate.
 *   - `pullLessons` + `pullPresets` return `null` on failure so callers keep
 *     using their existing local cache instead of clearing it.
 */
export interface HiveMindClient {
  isEnabled(): boolean;
  agentId(): string;
  registerAgent(reason?: string): Promise<void>;
  pushLesson(lesson: Lesson): Promise<HiveMindPushResult>;
  pushPerformance(perf: PerformanceRecord): Promise<HiveMindPushResult>;
  pullLessons(limit?: number): Promise<SharedLesson[] | null>;
  pullPresets(): Promise<SharedPreset[] | null>;
}
