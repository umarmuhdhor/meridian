import type { LoadError } from "../adapters/persistence/json/atomic-write.js";
import type { PoolMemoryDb, PoolMemoryEntry } from "../domain/schemas/pool-memory.js";
import type { Result } from "../shared/result.js";

export interface PoolMemoryRepo {
  load(): Promise<Result<PoolMemoryDb, LoadError>>;
  save(db: PoolMemoryDb): Promise<void>;
  get(poolAddress: string): Promise<PoolMemoryEntry | null>;
  upsert(poolAddress: string, entry: PoolMemoryEntry): Promise<void>;
}
