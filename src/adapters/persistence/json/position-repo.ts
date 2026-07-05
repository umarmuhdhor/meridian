import type { PositionRepo } from "../../../ports/position-repo.js";
import type { Clock } from "../../../ports/clock.js";
import type { Logger } from "../../../ports/logger.js";
import type { TrackedPosition } from "../../../domain/schemas/position.js";
import {
  emptyState,
  type RecentEvent,
  type StateFile,
  StateFileSchema,
} from "../../../domain/schemas/state.js";
import { err, ok, type Result } from "../../../shared/result.js";
import { formatLoadError, readJsonValidated, writeJsonAtomic, type LoadError } from "./atomic-write.js";

const MAX_RECENT_EVENTS = 20;

export interface JsonPositionRepoOptions {
  filePath: string;
  clock: Clock;
  logger: Logger;
}

/**
 * JSON-file backed position repo. Load path validates via Zod so corrupt files
 * fail loudly instead of returning silent NaN. Save path writes-tmp+rename for atomicity.
 */
export function createJsonPositionRepo(opts: JsonPositionRepoOptions): PositionRepo {
  const { filePath, clock, logger } = opts;

  async function loadOrEmpty(): Promise<Result<StateFile, LoadError>> {
    const r = await readJsonValidated(filePath, StateFileSchema);
    if (r.ok) return r;
    if (r.error.kind === "not_found") return ok(emptyState());
    logger.error("state", formatLoadError(r.error));
    return err(r.error);
  }

  async function saveWithTimestamp(state: StateFile): Promise<void> {
    const stamped: StateFile = { ...state, lastUpdated: clock.now().toISOString() };
    await writeJsonAtomic(filePath, stamped);
  }

  return {
    async load() {
      return loadOrEmpty();
    },

    async save(state: StateFile) {
      await saveWithTimestamp(state);
    },

    async get(positionAddress: string) {
      const r = await loadOrEmpty();
      if (!r.ok) return null;
      return r.value.positions[positionAddress] ?? null;
    },

    async all(openOnly = false) {
      const r = await loadOrEmpty();
      if (!r.ok) return [];
      const all = Object.values(r.value.positions);
      return openOnly ? all.filter((p) => !p.closed) : all;
    },

    async upsert(pos: TrackedPosition) {
      const r = await loadOrEmpty();
      const state = r.ok ? r.value : emptyState();
      state.positions[pos.position] = pos;
      await saveWithTimestamp(state);
    },

    async pushEvent(event: RecentEvent) {
      const r = await loadOrEmpty();
      const state = r.ok ? r.value : emptyState();
      const events = [...(state.recentEvents ?? []), event];
      state.recentEvents = events.slice(-MAX_RECENT_EVENTS);
      await saveWithTimestamp(state);
    },
  };
}
