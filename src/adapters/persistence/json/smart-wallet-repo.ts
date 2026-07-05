import type { SmartWalletRepo } from "../../../ports/smart-wallet-repo.js";
import type { Logger } from "../../../ports/logger.js";
import {
  emptySmartWalletFile,
  SmartWalletFileSchema,
  type SmartWallet,
  type SmartWalletFile,
} from "../../../domain/schemas/smart-wallet.js";
import { formatLoadError, readJsonValidated, writeJsonAtomic, type LoadError } from "./atomic-write.js";
import { err, ok, type Result } from "../../../shared/result.js";

export interface JsonSmartWalletRepoOptions {
  filePath: string;
  logger: Logger;
}

export function createJsonSmartWalletRepo(opts: JsonSmartWalletRepoOptions): SmartWalletRepo {
  const { filePath, logger } = opts;

  async function loadOrEmpty(): Promise<Result<SmartWalletFile, LoadError>> {
    const r = await readJsonValidated(filePath, SmartWalletFileSchema);
    if (r.ok) return r;
    if (r.error.kind === "not_found") return ok(emptySmartWalletFile());
    logger.error("smart-wallets", formatLoadError(r.error));
    return err(r.error);
  }

  return {
    async load() {
      return loadOrEmpty();
    },

    async list(): Promise<SmartWallet[]> {
      const r = await loadOrEmpty();
      return r.ok ? r.value.wallets : [];
    },

    async add(wallet: SmartWallet) {
      const r = await loadOrEmpty();
      const file = r.ok ? r.value : emptySmartWalletFile();
      const existingIdx = file.wallets.findIndex((w) => w.address === wallet.address);
      if (existingIdx === -1) file.wallets.push(wallet);
      else file.wallets[existingIdx] = wallet;
      await writeJsonAtomic(filePath, file);
    },

    async remove(address: string): Promise<boolean> {
      const r = await loadOrEmpty();
      if (!r.ok) return false;
      const file = r.value;
      const before = file.wallets.length;
      file.wallets = file.wallets.filter((w) => w.address !== address);
      if (file.wallets.length === before) return false;
      await writeJsonAtomic(filePath, file);
      return true;
    },
  };
}
