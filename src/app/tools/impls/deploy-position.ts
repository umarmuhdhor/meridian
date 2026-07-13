import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { DeployResultSchema } from "../../../domain/schemas/chain.js";
import { poolCooldownGate } from "../safety/pool-cooldown.js";
import { walletBalanceGate } from "../safety/wallet-balance.js";
import { maxPositionsGate } from "../safety/max-positions.js";
import { tokenBlacklistGate } from "../safety/token-blacklist.js";
import { deployerBlocklistGate } from "../safety/deployer-blocklist.js";
import { logDeployDecision } from "../post/log-decision.js";
import { notifyDeployHook } from "../post/notify.js";
import { trackDeployedPosition } from "../post/track-position.js";

const ArgsSchema = z.object({
  pool_address: z.string().min(1),
  amount_sol: z.number().positive(),
  strategy: z.enum(["spot", "curve", "bid_ask"]),
  bins_below: z.number().int().min(35).max(69),
  bins_above: z.number().int().nonnegative().default(0),
  pool_name: z.string().optional(),
  base_mint: z.string().nullable().optional(),
  bin_step: z.number().int().optional(),
  volatility: z.number().optional(),
  fee_tvl_ratio: z.number().optional(),
  organic_score: z.number().optional(),
});

/**
 * Full write path — safety chain gates on pool cooldown, base-mint cooldown, wallet balance,
 * max positions, blacklist. Post-hooks fire only on `result.success === true`: notify
 * Telegram + append decision log. Lock: oncePerSession + noRetry (first attempt is the last).
 */
export const deployPositionTool = defineTool({
  name: "deploy_position",
  description:
    "Open a Meteora DLMM position with the given SOL amount, strategy, and bin range. Safety-gated: pool cooldown, base-mint cooldown, wallet balance, max positions, token blacklist. Fires ONCE per agent session — the LLM cannot retry after any attempt.",
  args: ArgsSchema,
  result: DeployResultSchema,
  oncePerSession: true,
  noRetry: true,
  safety: [poolCooldownGate, tokenBlacklistGate, deployerBlocklistGate, walletBalanceGate, maxPositionsGate],
  post: [trackDeployedPosition(), notifyDeployHook, logDeployDecision("SCREENER")],
  execute: async (args, ctx) => {
    return ctx.chain.deployPosition({
      pool_address: args.pool_address,
      amount_sol: args.amount_sol,
      strategy: args.strategy,
      bins_below: args.bins_below,
      bins_above: args.bins_above,
      ...(args.pool_name !== undefined ? { pool_name: args.pool_name } : {}),
      ...(args.bin_step !== undefined ? { bin_step: args.bin_step } : {}),
      ...(args.volatility !== undefined ? { volatility: args.volatility } : {}),
      ...(args.fee_tvl_ratio !== undefined ? { fee_tvl_ratio: args.fee_tvl_ratio } : {}),
      ...(args.organic_score !== undefined ? { organic_score: args.organic_score } : {}),
    });
  },
});
