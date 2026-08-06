import type { AppContext } from "../tools/context.js";
import type { ToolRegistry } from "../tools/registry.js";
import { executeTool, type ToolError } from "../tools/execute.js";
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
  registry: ToolRegistry;
}

export interface ExecutedAction {
  plan: PositionPlan;
  ok: boolean;
  error?: ToolError;
}

export type ManagementOutcome =
  | { kind: "no_positions" }
  | { kind: "all_stay"; positions: number }
  | { kind: "executed"; plans: PositionPlan[]; results: ExecutedAction[] };

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

/**
 * Fully deterministic — no LLM. planForPosition picks the action; executeTool
 * runs it (with the full safety-gate + post-hook pipeline: notify cards, decision
 * log, auto-swap consolidation). LLM was previously used only to emit tool_calls,
 * adding latency, cost, and a once-per-session lock that capped closes to one
 * per cycle. Removing it fixes all three.
 *
 *   1. Fetch positions with `force: true` (fresh count).
 *   2. Reconcile any on-chain position missing from the tracking store.
 *   3. planForPosition per position.
 *   4. If every action is STAY → return `all_stay`.
 *   5. Else invoke each non-STAY action directly via executeTool, sequentially
 *      (safer than parallel — same wallet, same nonce space).
 */
export async function runManagementCycle(deps: ManagementCycleDeps): Promise<ManagementOutcome> {
  const { ctx, registry } = deps;

  const snap = await ctx.chain.getMyPositions({ force: true });

  // Reverse reconcile: any position tracked as OPEN in state.json but no longer
  // on-chain (closed via close_position, pnl-poller direct call, Meteora UI, etc.)
  // gets flipped to closed. Must run BEFORE the empty-snapshot early return, or
  // ghost-open records persist forever when the wallet is fully drained of
  // positions (dashboard summary reported 3 ghost open vs 0 on-chain, 2026-08-06).
  const nowIsoR = ctx.clock.now().toISOString();
  const onChainIds = new Set(snap.positions.map((p) => p.position));
  const tracked = await ctx.repos.positions.all();
  for (const t of tracked) {
    if (t.closed) continue;
    if (onChainIds.has(t.position)) continue;
    await ctx.repos.positions.upsert({
      ...t,
      closed: true,
      closed_at: nowIsoR,
      notes: [...(t.notes ?? []), "reconciled: no longer on-chain (external close or ghost record)"],
    });
    ctx.logger.info("management", `reconciled ghost-open position ${t.position.slice(0, 8)}… as closed`);
  }

  if (snap.total_positions === 0) {
    ctx.logger.info("management", "no positions — nothing to do");
    return { kind: "no_positions" };
  }

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

  // Update out_of_range_since on every tracked position based on the fresh
  // on-chain snapshot, then compute minutes_out_of_range so the deterministic
  // rule 3 (OOR) actually has a value to compare against. Without this, the
  // on-chain client never populates minutes_out_of_range → rule 3 sees 0 →
  // never fires. Result was OOR positions sitting open indefinitely
  // (2026-08-05: Doom-SOL held 24 bins past upper for hours, no close).
  const nowMs = ctx.clock.now().getTime();
  const oorEnrichedSnapshot = await Promise.all(
    snap.positions.map(async (p) => {
      const t = await ctx.repos.positions.get(p.position);
      if (!t || t.closed) return p;
      let oorSince = t.out_of_range_since;
      let mutated = false;
      if (p.in_range === false && !oorSince) {
        oorSince = ctx.clock.now().toISOString();
        mutated = true;
      } else if (p.in_range === true && oorSince) {
        oorSince = null;
        mutated = true;
      }
      if (mutated) {
        await ctx.repos.positions.upsert({ ...t, out_of_range_since: oorSince });
      }
      const minutesOOR =
        oorSince != null
          ? Math.max(0, Math.floor((nowMs - Date.parse(oorSince)) / 60_000))
          : 0;
      // Overlay the derived minutes_out_of_range onto the on-chain position so
      // planForPosition → close-rules rule 3 sees it. Age is also seeded from
      // tracked.deployed_at when the chain client left it null.
      const derivedAge =
        p.age_minutes ??
        (t.deployed_at
          ? Math.max(0, Math.floor((nowMs - Date.parse(t.deployed_at)) / 60_000))
          : null);
      return {
        ...p,
        minutes_out_of_range: minutesOOR,
        ...(derivedAge != null ? { age_minutes: derivedAge } : {}),
      };
    }),
  );

  const plans = oorEnrichedSnapshot.map((p) => planForPosition(p, ctx));
  const actionsList = plans.filter((p) => p.action !== "STAY");
  if (actionsList.length === 0) {
    ctx.logger.info("management", `all ${plans.length} positions STAY`);
    return { kind: "all_stay", positions: plans.length };
  }

  const results: ExecutedAction[] = [];
  for (const plan of actionsList) {
    const invocation =
      plan.action === "CLOSE"
        ? {
            name: "close_position",
            args: { position_address: plan.position.position, reason: plan.reason },
          }
        : {
            name: "claim_fees",
            args: { position_address: plan.position.position },
          };

    const r = await executeTool(registry, invocation, ctx);
    if (r.ok) {
      results.push({ plan, ok: true });
      ctx.logger.info(
        "management",
        `${plan.action} ${plan.position.position.slice(0, 8)}… ok (${plan.reason})`,
      );
    } else {
      results.push({ plan, ok: false, error: r.error });
      ctx.logger.warn(
        "management",
        `${plan.action} ${plan.position.position.slice(0, 8)}… failed: ${r.error.kind}`,
      );
    }
  }

  ctx.logger.info(
    "management",
    `executed ${results.filter((r) => r.ok).length}/${results.length} actions`,
  );
  return { kind: "executed", plans, results };
}
