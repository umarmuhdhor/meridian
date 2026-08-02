import type { PostHook } from "../types.js";
import type { CloseResult } from "../../../domain/schemas/chain.js";

/**
 * After a successful `close_position`, flip the tracked position to `closed:true`
 * in state.json. Without this, the position-repo accumulates ghost "open" records
 * forever — buildStateSummary reads state.json and reports stale open counts (e.g.
 * dashboard summary showed 36 records vs 0 on-chain, 2026-08-02).
 *
 * Uses the position args (not result) because `close_position` is invoked with a
 * `position_address` that the repo keys by, and result.position_address echoes it.
 *
 * Non-fatal — post-hook failures are swallowed by executeTool; a failed repo write
 * cannot break the on-chain close (which already committed).
 */
export const markClosedInRepoHook: PostHook<{ position_address: string; reason: string }, CloseResult> = async (
  args,
  result,
  ctx,
) => {
  if (!result.success) return;
  const tracked = await ctx.repos.positions.get(args.position_address);
  if (!tracked) return; // nothing to update (position was never tracked)
  await ctx.repos.positions.upsert({
    ...tracked,
    closed: true,
    closed_at: ctx.clock.now().toISOString(),
    notes: [...(tracked.notes ?? []), `closed via close_position: ${args.reason}`],
  });
};
