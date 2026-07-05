import type { SafetyCheck } from "../types.js";

export interface HasBaseMint {
  base_mint?: string | null | undefined;
}

/** Deny deploys/swaps whose base mint is on the token blacklist. */
export const tokenBlacklistGate: SafetyCheck<HasBaseMint> = async (args, ctx) => {
  if (!args.base_mint) return null;
  if (await ctx.repos.tokenBlacklist.isBlacklisted(args.base_mint)) {
    return { reason: `base mint ${args.base_mint.slice(0, 8)} is blacklisted` };
  }
  return null;
};
