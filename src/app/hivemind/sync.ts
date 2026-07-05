import type { Clock } from "../../ports/clock.js";
import type { Logger } from "../../ports/logger.js";
import type { Scheduler } from "../../ports/scheduler.js";
import type { HiveMindClient, SharedLesson, SharedPreset } from "../../ports/hivemind.js";

export const DEFAULT_HIVEMIND_SYNC_INTERVAL_MS = 15 * 60_000;

export interface HiveMindSyncState {
  sharedLessons: SharedLesson[];
  presets: SharedPreset[];
  pulledAt: string | null;
}

export interface HiveMindSyncDeps {
  clock: Clock;
  logger: Logger;
  scheduler: Scheduler;
  client: HiveMindClient;
  intervalMs?: number;
  onUpdate?: (state: HiveMindSyncState) => void;
}

export interface HiveMindSyncHandle {
  stop(): void;
  snapshot(): HiveMindSyncState;
}

/**
 * Background sync — every 15 min: heartbeat register + pull shared lessons + presets.
 *
 * Failures are non-blocking: the previous snapshot is kept, and the next tick tries
 * again. Callers read the snapshot to inject shared lessons into the SCREENER prompt
 * (mirrors `getSharedLessonsForPrompt` in hivemind.js).
 *
 * `bootstrap()` runs an immediate startup pass so the first snapshot is populated
 * before the SCREENER touches the prompt.
 */
export function createHiveMindSync(deps: HiveMindSyncDeps): HiveMindSyncHandle {
  let state: HiveMindSyncState = {
    sharedLessons: [],
    presets: [],
    pulledAt: null,
  };
  const intervalMs = deps.intervalMs ?? DEFAULT_HIVEMIND_SYNC_INTERVAL_MS;
  let busy = false;

  async function tick(reason: string): Promise<void> {
    if (!deps.client.isEnabled()) return;
    if (busy) return;
    busy = true;
    try {
      await deps.client.registerAgent(reason);
      const [lessons, presets] = await Promise.all([
        deps.client.pullLessons(),
        deps.client.pullPresets(),
      ]);
      let changed = false;
      if (lessons != null) {
        state = { ...state, sharedLessons: lessons };
        changed = true;
      }
      if (presets != null) {
        state = { ...state, presets };
        changed = true;
      }
      if (changed) {
        state = { ...state, pulledAt: deps.clock.now().toISOString() };
        deps.onUpdate?.(state);
      }
    } catch (err) {
      deps.logger.warn("hivemind-sync", "tick failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      busy = false;
    }
  }

  // Fire an immediate bootstrap pass so the SCREENER isn't racing an empty cache.
  if (deps.client.isEnabled()) {
    void tick("startup");
  }

  const handle = deps.scheduler.every(intervalMs, () => tick("heartbeat"), "hivemind-sync");

  return {
    stop: () => handle.cancel(),
    snapshot: () => ({ ...state, sharedLessons: state.sharedLessons.slice(), presets: state.presets.slice() }),
  };
}
