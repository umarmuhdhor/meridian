import type { SmartWallet, SmartWalletFile } from "../domain/schemas/smart-wallet.js";
import type { LoadError } from "../adapters/persistence/json/atomic-write.js";
import type { Result } from "../shared/result.js";

export interface SmartWalletRepo {
  load(): Promise<Result<SmartWalletFile, LoadError>>;
  list(): Promise<SmartWallet[]>;
  add(wallet: SmartWallet): Promise<void>;
  remove(address: string): Promise<boolean>;
}
