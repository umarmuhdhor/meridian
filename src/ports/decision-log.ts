import type { DecisionEntry, DecisionLogFile } from "../domain/schemas/decision.js";
import type { LoadError } from "../adapters/persistence/json/atomic-write.js";
import type { Result } from "../shared/result.js";

export interface DecisionLogRepo {
  load(): Promise<Result<DecisionLogFile, LoadError>>;
  append(entry: DecisionEntry): Promise<void>;
  recent(limit?: number): Promise<DecisionEntry[]>;
}
