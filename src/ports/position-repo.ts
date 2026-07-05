import type { TrackedPosition } from "../domain/schemas/position.js";
import type { RecentEvent, StateFile } from "../domain/schemas/state.js";
import type { LoadError } from "../adapters/persistence/json/atomic-write.js";
import type { Result } from "../shared/result.js";

export interface PositionRepo {
  /** Load full state file. Empty on missing; error on corrupt/schema mismatch. */
  load(): Promise<Result<StateFile, LoadError>>;
  /** Overwrite the whole state file atomically. */
  save(state: StateFile): Promise<void>;
  /** Read one position (null if unknown). */
  get(positionAddress: string): Promise<TrackedPosition | null>;
  /** Read all positions, optionally filtering to open only. */
  all(openOnly?: boolean): Promise<TrackedPosition[]>;
  /** Insert or replace one position (single-file mutation). */
  upsert(pos: TrackedPosition): Promise<void>;
  /** Append a recent event (bounded ring buffer). */
  pushEvent(event: RecentEvent): Promise<void>;
}
