import type { PostHook } from "../types.js";
import type { DeployResult, CloseResult } from "../../../domain/schemas/chain.js";
import type { DecisionActor } from "../../../domain/schemas/decision.js";
import { sanitizeDecisionText } from "../../../domain/schemas/decision.js";
import {
  formatCloseReason,
  formatCloseSummary,
  formatDeployReason,
  formatDeploySummary,
} from "../../../domain/format/decision-strings.js";

function nextId(now: Date): string {
  return `dec_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Post-hook: append a deploy decision after every successful deploy_position call. */
export function logDeployDecision(actor: DecisionActor): PostHook<{
  pool_address: string;
  pool_name?: string | undefined;
  amount_sol: number;
  strategy: string;
  bin_step?: number | undefined;
}, DeployResult> {
  return async (args, result, ctx) => {
    if (!result.success) return;
    const input = {
      pool_name: args.pool_name ?? null,
      pool_address: args.pool_address,
      amount_sol: args.amount_sol,
      strategy: args.strategy,
      lower_bin: result.lower_bin,
      upper_bin: result.upper_bin,
      active_bin: result.active_bin,
      bin_step: args.bin_step ?? result.bin_step ?? null,
    };
    await ctx.repos.decisions.append({
      id: nextId(ctx.clock.now()),
      ts: ctx.clock.now().toISOString(),
      type: "deploy",
      actor,
      pool: args.pool_address,
      pool_name: sanitizeDecisionText(args.pool_name ?? null, 120),
      position: result.position_address,
      summary: sanitizeDecisionText(formatDeploySummary(input)),
      reason: sanitizeDecisionText(formatDeployReason(input), 500),
      risks: [],
      metrics: {
        amount_sol: args.amount_sol,
        active_bin: result.active_bin,
        lower_bin: result.lower_bin,
        upper_bin: result.upper_bin,
        ...(input.bin_step != null ? { bin_step: input.bin_step } : {}),
      },
      rejected: [],
    });
  };
}

/** Post-hook: append a close decision after every successful close_position call. */
export function logCloseDecision(actor: DecisionActor): PostHook<{ position_address: string; reason: string }, CloseResult> {
  return async (args, result, ctx) => {
    if (!result.success) return;
    const input = {
      position_address: args.position_address,
      final_pnl_pct: result.final_pnl_pct,
      final_value_usd: result.final_value_usd,
      fees_earned_usd: result.fees_earned_usd,
      reason: result.reason || args.reason,
    };
    await ctx.repos.decisions.append({
      id: nextId(ctx.clock.now()),
      ts: ctx.clock.now().toISOString(),
      type: "close",
      actor,
      pool: result.pool_address,
      pool_name: null,
      position: args.position_address,
      summary: sanitizeDecisionText(formatCloseSummary(input)),
      reason: sanitizeDecisionText(formatCloseReason(input), 500),
      risks: [],
      metrics: {
        pnl_pct: result.final_pnl_pct,
        final_value_usd: result.final_value_usd,
        fees_earned_usd: result.fees_earned_usd,
      },
      rejected: [],
    });
  };
}
