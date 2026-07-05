import type { StrategyRepo } from "../../../ports/strategy-repo.js";
import type { Logger } from "../../../ports/logger.js";
import {
  defaultStrategyLibrary,
  StrategyLibrarySchema,
  type StrategyEntry,
  type StrategyLibrary,
} from "../../../domain/schemas/strategy.js";
import { formatLoadError, readJsonValidated, writeJsonAtomic, type LoadError } from "./atomic-write.js";
import { err, ok, type Result } from "../../../shared/result.js";

export interface JsonStrategyRepoOptions {
  filePath: string;
  logger: Logger;
}

export function createJsonStrategyRepo(opts: JsonStrategyRepoOptions): StrategyRepo {
  const { filePath, logger } = opts;

  async function loadOrDefaults(): Promise<Result<StrategyLibrary, LoadError>> {
    const r = await readJsonValidated(filePath, StrategyLibrarySchema);
    if (r.ok) return r;
    if (r.error.kind === "not_found") return ok(defaultStrategyLibrary());
    logger.error("strategy-library", formatLoadError(r.error));
    return err(r.error);
  }

  return {
    async load() {
      return loadOrDefaults();
    },

    async save(lib: StrategyLibrary) {
      await writeJsonAtomic(filePath, lib);
    },

    async getActive(): Promise<StrategyEntry | null> {
      const r = await loadOrDefaults();
      if (!r.ok) return null;
      return r.value.strategies[r.value.active] ?? null;
    },

    async setActive(id: string): Promise<boolean> {
      const r = await loadOrDefaults();
      if (!r.ok) return false;
      const lib = r.value;
      if (!lib.strategies[id]) return false;
      lib.active = id;
      await writeJsonAtomic(filePath, lib);
      return true;
    },

    async list(): Promise<StrategyEntry[]> {
      const r = await loadOrDefaults();
      if (!r.ok) return [];
      return Object.values(r.value.strategies);
    },

    async upsert(entry: StrategyEntry) {
      const r = await loadOrDefaults();
      const lib = r.ok ? r.value : defaultStrategyLibrary();
      lib.strategies[entry.id] = entry;
      await writeJsonAtomic(filePath, lib);
    },

    async remove(id: string): Promise<boolean> {
      const r = await loadOrDefaults();
      if (!r.ok) return false;
      const lib = r.value;
      if (!lib.strategies[id]) return false;
      delete lib.strategies[id];
      if (lib.active === id) lib.active = Object.keys(lib.strategies)[0] ?? "custom_ratio_spot";
      await writeJsonAtomic(filePath, lib);
      return true;
    },
  };
}
