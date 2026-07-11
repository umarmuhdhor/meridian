import type { TokenBlacklistRepo } from "../../../ports/token-blacklist-repo.js";
import type { Logger } from "../../../ports/logger.js";
import {
  emptyBlacklist,
  TokenBlacklistFileSchema,
  type BlacklistEntry,
  type TokenBlacklistFile,
} from "../../../domain/schemas/blacklist.js";
import { formatLoadError, readJsonValidated, writeJsonAtomic, type LoadError } from "./atomic-write.js";
import { err, ok, type Result } from "../../../shared/result.js";

export interface JsonTokenBlacklistOptions {
  filePath: string;
  logger: Logger;
}

export function createJsonTokenBlacklistRepo(opts: JsonTokenBlacklistOptions): TokenBlacklistRepo {
  const { filePath, logger } = opts;

  async function loadOrEmpty(): Promise<Result<TokenBlacklistFile, LoadError>> {
    const r = await readJsonValidated(filePath, TokenBlacklistFileSchema);
    if (r.ok) return r;
    if (r.error.kind === "not_found") return ok(emptyBlacklist());
    logger.error("token-blacklist", formatLoadError(r.error));
    return err(r.error);
  }

  return {
    async load() {
      return loadOrEmpty();
    },

    async isBlacklisted(mint: string) {
      const r = await loadOrEmpty();
      if (!r.ok) return false;
      return Object.prototype.hasOwnProperty.call(r.value, mint);
    },

    async add(mint: string, entry: BlacklistEntry) {
      const r = await loadOrEmpty();
      const file = r.ok ? r.value : emptyBlacklist();
      file[mint] = entry;
      await writeJsonAtomic(filePath, file);
    },

    async remove(mint: string): Promise<boolean> {
      const r = await loadOrEmpty();
      if (!r.ok) return false;
      const file = r.value;
      if (!Object.prototype.hasOwnProperty.call(file, mint)) return false;
      delete file[mint];
      await writeJsonAtomic(filePath, file);
      return true;
    },

    async list() {
      const r = await loadOrEmpty();
      if (!r.ok) return [];
      return Object.entries(r.value).map(([mint, entry]) => ({ mint, entry }));
    },
  };
}
