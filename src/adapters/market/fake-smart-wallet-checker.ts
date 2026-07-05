import type { SmartWalletChecker } from "../../ports/smart-wallet-checker.js";
import type { SmartWalletMatch } from "../../domain/schemas/market.js";

export interface FakeSmartWalletCheckerOptions {
  /** Keyed by pool address — matches returned for that pool. */
  matches?: Record<string, SmartWalletMatch[]>;
  /** Keyed by base_mint — matches returned when the pool has this base mint. */
  matchesByMint?: Record<string, SmartWalletMatch[]>;
}

export function createFakeSmartWalletChecker(
  opts: FakeSmartWalletCheckerOptions = {},
): SmartWalletChecker {
  const matches = { ...(opts.matches ?? {}) };
  const matchesByMint = { ...(opts.matchesByMint ?? {}) };
  return {
    async checkPool(poolAddress: string, baseMint: string | null): Promise<SmartWalletMatch[]> {
      const byPool = matches[poolAddress] ?? [];
      const byMint = baseMint ? (matchesByMint[baseMint] ?? []) : [];
      return [...byPool, ...byMint];
    },
  };
}
