import type { DevBlocklistEntry, DevBlocklistFile } from "../domain/schemas/dev-blocklist.js";
import type { LoadError } from "../adapters/persistence/json/atomic-write.js";
import type { Result } from "../shared/result.js";

export interface DevBlocklistRepo {
  load(): Promise<Result<DevBlocklistFile, LoadError>>;
  isBlocked(wallet: string): Promise<boolean>;
  add(wallet: string, entry: DevBlocklistEntry): Promise<void>;
  remove(wallet: string): Promise<boolean>;
  list(): Promise<Array<{ wallet: string; entry: DevBlocklistEntry }>>;
}
