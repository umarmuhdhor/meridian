import { isBaseMintOnCooldown, isPoolOnCooldown } from "../../../domain/rules/cooldown.js";
import type { SafetyCheck } from "../types.js";

export interface HasPool {
  pool_address: string;
  base_mint?: string | null | undefined;
}

/**
 * Safety chain link — deny when either the pool itself or (optionally) its base mint
 * is inside a cooldown window. Load-once-per-check to keep read cost bounded.
 */
export const poolCooldownGate: SafetyCheck<HasPool> = async (args, ctx) => {
  const now = ctx.clock.now();
  const entry = await ctx.repos.poolMemory.get(args.pool_address);
  if (isPoolOnCooldown(entry, now)) {
    return {
      reason: `pool ${args.pool_address.slice(0, 8)} on cooldown until ${entry?.cooldown_until ?? "?"} (${entry?.cooldown_reason ?? "?"})`,
    };
  }
  if (args.base_mint) {
    const dbResult = await ctx.repos.poolMemory.load();
    if (!dbResult.ok) return null;
    if (isBaseMintOnCooldown(dbResult.value, args.base_mint, now)) {
      return { reason: `base mint ${args.base_mint.slice(0, 8)} on cooldown` };
    }
  }
  return null;
};
