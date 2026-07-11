import type { DevBlocklistRepo } from "../../../ports/dev-blocklist-repo.js";
import type { Logger } from "../../../ports/logger.js";
import {
  emptyDevBlocklist,
  DevBlocklistFileSchema,
  type DevBlocklistEntry,
  type DevBlocklistFile,
} from "../../../domain/schemas/dev-blocklist.js";
import { formatLoadError, readJsonValidated, writeJsonAtomic, type LoadError } from "./atomic-write.js";
import { err, ok, type Result } from "../../../shared/result.js";

export interface JsonDevBlocklistOptions {
  filePath: string;
  logger: Logger;
}

export function createJsonDevBlocklistRepo(opts: JsonDevBlocklistOptions): DevBlocklistRepo {
  const { filePath, logger } = opts;

  async function loadOrEmpty(): Promise<Result<DevBlocklistFile, LoadError>> {
    const r = await readJsonValidated(filePath, DevBlocklistFileSchema);
    if (r.ok) return r;
    if (r.error.kind === "not_found") return ok(emptyDevBlocklist());
    logger.error("dev-blocklist", formatLoadError(r.error));
    return err(r.error);
  }

  return {
    async load() {
      return loadOrEmpty();
    },

    async isBlocked(wallet: string) {
      const r = await loadOrEmpty();
      if (!r.ok) return false;
      return Object.prototype.hasOwnProperty.call(r.value, wallet);
    },

    async add(wallet: string, entry: DevBlocklistEntry) {
      const r = await loadOrEmpty();
      const file = r.ok ? r.value : emptyDevBlocklist();
      file[wallet] = entry;
      await writeJsonAtomic(filePath, file);
    },

    async remove(wallet: string): Promise<boolean> {
      const r = await loadOrEmpty();
      if (!r.ok) return false;
      const file = r.value;
      if (!Object.prototype.hasOwnProperty.call(file, wallet)) return false;
      delete file[wallet];
      await writeJsonAtomic(filePath, file);
      return true;
    },

    async list() {
      const r = await loadOrEmpty();
      if (!r.ok) return [];
      return Object.entries(r.value).map(([wallet, entry]) => ({ wallet, entry }));
    },
  };
}
