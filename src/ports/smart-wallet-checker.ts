import type { SmartWalletMatch } from "../domain/schemas/market.js";

export interface SmartWalletChecker {
  /**
   * Return smart-wallet matches for a pool. `lp` types match if the wallet has an open
   * position in this pool; `holder` types match if the wallet holds the base mint.
   */
  checkPool(poolAddress: string, baseMint: string | null): Promise<SmartWalletMatch[]>;
}
