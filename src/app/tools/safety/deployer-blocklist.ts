import type { SafetyCheck } from "../types.js";
import type { HasBaseMint } from "./token-blacklist.js";

/**
 * Deny deploys whose token deployer is on the dev-blocklist. The deployer is resolved
 * from the token-info source for the base mint; if that lookup fails we do NOT block
 * (fail-open) so a transient enrichment error never wedges the screener.
 */
export const deployerBlocklistGate: SafetyCheck<HasBaseMint> = async (args, ctx) => {
  if (!args.base_mint) return null;
  let deployer: string | null = null;
  try {
    const info = await ctx.market.tokenInfo.getInfo(args.base_mint);
    deployer = info.deployer;
  } catch {
    return null; // enrichment unavailable → fail open
  }
  if (deployer && (await ctx.repos.devBlocklist.isBlocked(deployer))) {
    return { reason: `deployer ${deployer.slice(0, 8)} is blocked` };
  }
  return null;
};
