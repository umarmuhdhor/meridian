import type { StrategyEntry, StrategyLibrary } from "../domain/schemas/strategy.js";
import type { LoadError } from "../adapters/persistence/json/atomic-write.js";
import type { Result } from "../shared/result.js";

export interface StrategyRepo {
  load(): Promise<Result<StrategyLibrary, LoadError>>;
  save(lib: StrategyLibrary): Promise<void>;
  getActive(): Promise<StrategyEntry | null>;
  setActive(id: string): Promise<boolean>;
  list(): Promise<StrategyEntry[]>;
  upsert(entry: StrategyEntry): Promise<void>;
  remove(id: string): Promise<boolean>;
}
