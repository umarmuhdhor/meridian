import type { SafetyCheck } from "../types.js";

/**
 * Deny deploys when open-position count is at maxPositions. Uses `force: true` to bypass
 * the 5-min cache — matches tools/executor.js safety check that always fetches fresh.
 */
export const maxPositionsGate: SafetyCheck<unknown> = async (_args, ctx) => {
  const snap = await ctx.chain.getMyPositions({ force: true });
  if (snap.total_positions >= ctx.config.risk.maxPositions) {
    return {
      reason: `at max positions (${snap.total_positions}/${ctx.config.risk.maxPositions})`,
    };
  }
  return null;
};
