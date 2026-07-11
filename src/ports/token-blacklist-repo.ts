import type { BlacklistEntry, TokenBlacklistFile } from "../domain/schemas/blacklist.js";
import type { LoadError } from "../adapters/persistence/json/atomic-write.js";
import type { Result } from "../shared/result.js";

export interface TokenBlacklistRepo {
  load(): Promise<Result<TokenBlacklistFile, LoadError>>;
  isBlacklisted(mint: string): Promise<boolean>;
  add(mint: string, entry: BlacklistEntry): Promise<void>;
  remove(mint: string): Promise<boolean>;
  list(): Promise<Array<{ mint: string; entry: BlacklistEntry }>>;
}
