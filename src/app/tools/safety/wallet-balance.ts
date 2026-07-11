import type { SafetyCheck } from "../types.js";

export interface HasAmountSol {
  amount_sol: number;
}

/**
 * Deny deploys when the wallet can't cover `amount_sol + gasReserve`. Mirrors the
 * balance guard in tools/executor.js#runSafetyChecks.
 */
export const walletBalanceGate: SafetyCheck<HasAmountSol> = async (args, ctx) => {
  const balance = await ctx.chain.getWalletBalance();
  const need = args.amount_sol + ctx.config.management.gasReserve;
  if (balance.sol < need) {
    return {
      reason: `wallet has ${balance.sol.toFixed(4)} SOL, needs ${need.toFixed(4)} (amount_sol=${args.amount_sol} + gasReserve=${ctx.config.management.gasReserve})`,
    };
  }
  return null;
};
