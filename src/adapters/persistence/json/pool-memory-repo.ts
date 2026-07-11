import type { PoolMemoryRepo } from "../../../ports/pool-memory-repo.js";
import type { Logger } from "../../../ports/logger.js";
import {
  PoolMemoryDbSchema,
  type PoolMemoryDb,
  type PoolMemoryEntry,
} from "../../../domain/schemas/pool-memory.js";
import { err, ok, type Result } from "../../../shared/result.js";
import { formatLoadError, readJsonValidated, writeJsonAtomic, type LoadError } from "./atomic-write.js";

export interface JsonPoolMemoryRepoOptions {
  filePath: string;
  logger: Logger;
}

export function createJsonPoolMemoryRepo(opts: JsonPoolMemoryRepoOptions): PoolMemoryRepo {
  const { filePath, logger } = opts;

  async function loadOrEmpty(): Promise<Result<PoolMemoryDb, LoadError>> {
    const r = await readJsonValidated(filePath, PoolMemoryDbSchema);
    if (r.ok) return r;
    if (r.error.kind === "not_found") return ok({});
    logger.error("pool-memory", formatLoadError(r.error));
    return err(r.error);
  }

  return {
    async load() {
      return loadOrEmpty();
    },

    async save(db: PoolMemoryDb) {
      await writeJsonAtomic(filePath, db);
    },

    async get(poolAddress: string) {
      const r = await loadOrEmpty();
      if (!r.ok) return null;
      return r.value[poolAddress] ?? null;
    },

    async upsert(poolAddress: string, entry: PoolMemoryEntry) {
      const r = await loadOrEmpty();
      const db = r.ok ? r.value : {};
      db[poolAddress] = entry;
      await writeJsonAtomic(filePath, db);
    },
  };
}
