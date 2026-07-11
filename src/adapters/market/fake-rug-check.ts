import type { RugCheckClient } from "../../ports/rug-check.js";
import type { RugCheckResult } from "../../domain/schemas/market.js";

export interface FakeRugCheckOptions {
  results?: Record<string, RugCheckResult>;
  /** Default when a mint isn't seeded. */
  defaultPass?: boolean;
}

export function createFakeRugCheck(opts: FakeRugCheckOptions = {}): RugCheckClient {
  const results = { ...(opts.results ?? {}) };
  const defaultPass = opts.defaultPass ?? true;
  return {
    async check(mint: string): Promise<RugCheckResult> {
      const hit = results[mint];
      if (hit) return hit;
      return {
        mint,
        score: defaultPass ? 1000 : 100_000,
        top10_pct: 20,
        passes: defaultPass,
        reason: defaultPass ? null : "unseeded — default fail",
      };
    },
  };
}
