import type { AppContext } from "../tools/context.js";
import type { LLMClient } from "../../ports/llm-client.js";
import type { ToolRegistry } from "../tools/registry.js";
import { runAgentLoop, type AgentLoopResult } from "../agent/loop.js";
import { buildSystemPrompt } from "../../domain/prompt/builder.js";
import { MANAGER_TOOLS } from "../../domain/prompt/role-tools.js";
import { getDeterministicCloseRule } from "../../domain/rules/close-rules.js";
import type { OnChainPosition } from "../../domain/schemas/chain.js";

export type PositionAction = "CLOSE" | "CLAIM" | "STAY";

export interface PositionPlan {
  position: OnChainPosition;
  action: PositionAction;
  reason: string;
}

export interface ManagementCycleDeps {
  ctx: AppContext;
  llm: LLMClient;
  registry: ToolRegistry;
  model: string;
}

export type ManagementOutcome =
  | { kind: "no_positions" }
  | { kind: "all_stay"; positions: number }
  | { kind: "invoked"; plans: PositionPlan[]; agent: AgentLoopResult };

/**
 * Pure — decide the action for a single position. Priority:
 *   1. Deterministic close rule (5 hard rules).
 *   2. Claim if unclaimed fees ≥ threshold.
 *   3. Else STAY.
 */
export function planForPosition(
  position: OnChainPosition,
  ctx: Pick<AppContext, "config">,
): PositionPlan {
  const close = getDeterministicCloseRule(
    {
      position: position.position,
      pnl_pct: position.pnl_pct,
      pnl_pct_suspicious: position.pnl_pct_suspicious,
      total_value_usd: position.total_value_usd ?? null,
      in_range: position.in_range,
      active_bin: position.active_bin,
      upper_bin: position.upper_bin,
      lower_bin: position.lower_bin,
      minutes_out_of_range: position.minutes_out_of_range ?? 0,
      fee_per_tvl_24h: position.fee_per_tvl_24h ?? null,
      age_minutes: position.age_minutes ?? 0,
    },
    ctx.config.management,
  );
  if (close) {
    return { position, action: "CLOSE", reason: close.reason };
  }
  if (position.unclaimed_fees_usd >= ctx.config.management.minClaimAmount) {
    return {
      position,
      action: "CLAIM",
      reason: `unclaimed_fees_usd ${position.unclaimed_fees_usd.toFixed(2)} ≥ ${ctx.config.management.minClaimAmount}`,
    };
  }
  return { position, action: "STAY", reason: "all rules pass" };
}

function formatPlanBlock(plans: PositionPlan[]): string {
  return plans
    .map((p, i) => {
      const pnl = p.position.pnl_pct == null ? "?" : `${p.position.pnl_pct.toFixed(2)}%`;
      return `  [${i + 1}] ${p.position.pair} pos=${p.position.position.slice(0, 8)}... pnl=${pnl} → ${p.action} (${p.reason})`;
    })
    .join("\n");
}

/**
 * Hybrid decider — mostly deterministic, LLM only for CLOSE/CLAIM execution.
 *
 *   1. Fetch positions with `force: true` (fresh count).
 *   2. Compute action plan for each position via `planForPosition`.
 *   3. If every action is STAY → return `all_stay` (LLM never called).
 *   4. Else build a system prompt + goal listing the plans and invoke agent loop.
 *      The LLM executes; it does NOT re-evaluate — matches the current JS design that
 *      prevents hallucinated rule reversal.
 */
export async function runManagementCycle(deps: ManagementCycleDeps): Promise<ManagementOutcome> {
  const { ctx, llm, registry, model } = deps;

  const snap = await ctx.chain.getMyPositions({ force: true });
  if (snap.total_positions === 0) {
    ctx.logger.info("management", "no positions — nothing to do");
    return { kind: "no_positions" };
  }

  // Self-heal: persist any on-chain position missing from the tracking store so
  // trailing-TP (needs stored peak) + age/low-yield rules (need deployed_at) work.
  // deploy_position tracks new deploys directly; this covers pre-fix positions and
  // any edge case where the deploy hook didn't run. Uses snapshot metadata where the
  // datapi provides it; deployed_at falls back to first-seen time.
  for (const p of snap.positions) {
    if (await ctx.repos.positions.get(p.position)) continue;
    const nowIso = ctx.clock.now().toISOString();
    await ctx.repos.positions.upsert({
      position: p.position,
      pool: p.pool,
      pool_name: p.pair,
      strategy: p.strategy ?? ctx.config.strategy.strategy,
      bin_range: { lower_bin: p.lower_bin, upper_bin: p.upper_bin },
      amount_sol: p.amount_sol ?? 0,
      amount_x: 0,
      active_bin_at_deploy: p.active_bin,
      bin_step: p.bin_step ?? null,
      volatility: null,
      fee_tvl_ratio: null,
      initial_fee_tvl_24h: p.fee_per_tvl_24h ?? null,
      organic_score: null,
      initial_value_usd: p.total_value_usd ?? null,
      deployed_at: p.deployed_at ?? nowIso,
      out_of_range_since: null,
      last_claim_at: null,
      total_fees_claimed_usd: 0,
      rebalance_count: 0,
      closed: false,
      closed_at: null,
      notes: ["reconciled from chain (untracked on-chain position)"],
      peak_pnl_pct: 0,
      trailing_active: false,
    });
    ctx.logger.info("management", `reconciled untracked position ${p.position.slice(0, 8)} into state`);
  }

  const plans = snap.positions.map((p) => planForPosition(p, ctx));
  const anyAction = plans.some((p) => p.action !== "STAY");
  if (!anyAction) {
    ctx.logger.info("management", `all ${plans.length} positions STAY`);
    return { kind: "all_stay", positions: plans.length };
  }

  const [wallet, activeStrategy, recentDecisions] = await Promise.all([
    ctx.chain.getWalletBalance(),
    ctx.repos.strategies.getActive(),
    ctx.repos.decisions.recent(5),
  ]);

  const systemPrompt = buildSystemPrompt({
    role: "MANAGER",
    wallet,
    positions: snap,
    config: ctx.config,
    activeStrategy,
    recentDecisions,
  });

  const actionsList = plans.filter((p) => p.action !== "STAY");
  const goal = [
    "MANAGEMENT CYCLE — execute the following pre-decided actions. Do NOT re-evaluate rules.",
    "",
    "ACTIONS (do these in order):",
    formatPlanBlock(actionsList),
    "",
    "For CLOSE actions: call `close_position` with the exact position_address and use the reason string above.",
    "For CLAIM actions: call `claim_fees` with the exact position_address.",
  ].join("\n");

  const agent = await runAgentLoop(
    { llm, registry, ctx },
    {
      role: "MANAGER",
      goal,
      systemPrompt,
      model,
      maxSteps: 6 + plans.length * 2,
      toolFilter: MANAGER_TOOLS,
      requireToolOnFirstStep: true,
    },
  );

  ctx.logger.info(
    "management",
    `invoked agent — steps=${agent.steps} finish=${agent.finishReason} plans=${actionsList.length}`,
  );
  return { kind: "invoked", plans, agent };
}
