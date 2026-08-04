import type { PostHook } from "../types.js";
import type { CloseResult } from "../../../domain/schemas/chain.js";
import type { PerformanceRecord } from "../../../domain/schemas/lesson.js";

/**
 * Append a PerformanceRecord to lessons.json after a successful close.
 * Without this the morning briefing (BriefingCounts.net_pnl_usd_24h /
 * fees_usd_24h / win_rate_pct_24h) is permanently empty — nothing else
 * calls `repos.lessons.appendPerformance`.
 *
 * Non-fatal: hook errors are swallowed by executeTool.
 */
export const recordPerformanceHook: PostHook<
  { position_address: string; reason: string },
  CloseResult
> = async (args, result, ctx) => {
  if (!result.success) return;

  const tracked = await ctx.repos.positions.get(args.position_address);

  let solPrice: number | null = null;
  try {
    const wallet = await ctx.chain.getWalletBalance();
    solPrice = wallet.sol_price;
  } catch {
    // Non-fatal — pnl_usd will fall back to 0 rather than crash the hook.
  }

  const amountSol = result.amount_sol_initial ?? tracked?.amount_sol ?? null;
  const initialValueUsd =
    tracked?.initial_value_usd ??
    (amountSol != null && solPrice != null ? amountSol * solPrice : null);
  const finalValueUsd = result.final_value_usd ?? null;
  const pnlPct = result.final_pnl_pct ?? 0;

  let pnlUsd = 0;
  if (finalValueUsd != null && initialValueUsd != null) {
    pnlUsd = finalValueUsd - initialValueUsd;
  } else if (initialValueUsd != null) {
    pnlUsd = (initialValueUsd * pnlPct) / 100;
  }

  const now = ctx.clock.now();
  const deployedAtMs = tracked?.deployed_at ? Date.parse(tracked.deployed_at) : NaN;
  const minutesHeld = Number.isFinite(deployedAtMs)
    ? Math.max(0, Math.round((now.getTime() - deployedAtMs) / 60_000))
    : undefined;

  const perf: PerformanceRecord = {
    position: args.position_address,
    pool: result.pool_address,
    pool_name: tracked?.pool_name ?? result.pair ?? null,
    pnl_pct: pnlPct,
    pnl_usd: Math.round(pnlUsd * 100) / 100,
    fees_earned_usd: result.fees_earned_usd,
    ...(initialValueUsd != null ? { initial_value_usd: initialValueUsd } : {}),
    ...(finalValueUsd != null ? { final_value_usd: finalValueUsd } : {}),
    ...(minutesHeld !== undefined ? { minutes_held: minutesHeld } : {}),
    close_reason: args.reason,
    ...(amountSol != null ? { amount_sol: amountSol } : {}),
    recorded_at: now.toISOString(),
  };

  try {
    await ctx.repos.lessons.appendPerformance(perf);
    ctx.logger.info("perf", `recorded close ${args.position_address.slice(0, 8)}`, {
      pnl_pct: perf.pnl_pct,
      pnl_usd: perf.pnl_usd,
      fees_usd: perf.fees_earned_usd,
      reason: args.reason,
    });
  } catch (err) {
    ctx.logger.warn("perf", "appendPerformance failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
