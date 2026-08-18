import type { PostHook } from "../types.js";
import type { CloseResult } from "../../../domain/schemas/chain.js";
import type { PoolMemoryEntry } from "../../../domain/schemas/pool-memory.js";

/**
 * After every successful close, stamp cooldown_until on the pool-memory entry so
 * the screener + safety chain block redeploys into the same pool (and, when
 * scope="token", into any pool sharing the same base mint) for the configured
 * window. Without this the `cooldown_until` field is dead — nothing writes it —
 * and the daemon can (and did, 2026-08-11) redeploy a token the user just
 * manually closed at a loss because it "scored well again".
 *
 * Non-fatal: cooldown-write failures are logged and swallowed; the close
 * already committed on-chain.
 */
export const setCooldownOnCloseHook: PostHook<
  { position_address: string; reason: string },
  CloseResult
> = async (args, result, ctx) => {
  if (!result.success) return;
  const cfg = ctx.config.management;
  if (!cfg.repeatDeployCooldownEnabled || cfg.repeatDeployCooldownHours <= 0) return;

  const poolAddress = result.pool_address;
  if (!poolAddress) return;

  // Only cool down after losses. Profitable closes leave the pool immediately re-deployable.
  const pnlPct = result.final_pnl_pct;
  if (pnlPct != null && pnlPct >= 0) {
    ctx.logger.info("cooldown", `skip cooldown ${poolAddress.slice(0, 8)} — closed in profit (${pnlPct.toFixed(2)}%)`);
    return;
  }

  const now = ctx.clock.now();
  const until = new Date(now.getTime() + cfg.repeatDeployCooldownHours * 60 * 60 * 1000).toISOString();
  const reason = `closed ${pnlPct != null ? `at ${pnlPct.toFixed(2)}%` : ""} (${args.reason}) — ${cfg.repeatDeployCooldownHours}h no-redeploy window`;

  const existing = await ctx.repos.poolMemory.get(poolAddress);
  const baseMint = existing?.base_mint ?? result.base_mint ?? null;
  const next: PoolMemoryEntry = existing
    ? { ...existing }
    : {
        name: result.pair ?? poolAddress.slice(0, 8),
        base_mint: baseMint,
        deploys: [],
        total_deploys: 0,
        avg_pnl_pct: 0,
        win_rate: 0,
        adjusted_win_rate: 0,
        adjusted_win_rate_sample_count: 0,
        last_deployed_at: null,
        last_outcome: null,
        notes: [],
        snapshots: [],
      };

  next.cooldown_until = until;
  next.cooldown_reason = reason;
  if (cfg.repeatDeployCooldownScope === "token" && baseMint) {
    next.base_mint_cooldown_until = until;
    next.base_mint_cooldown_reason = reason;
    next.base_mint = baseMint;
  }

  try {
    await ctx.repos.poolMemory.upsert(poolAddress, next);
    ctx.logger.info("cooldown", `wrote cooldown ${poolAddress.slice(0, 8)} until ${until}`, {
      scope: cfg.repeatDeployCooldownScope,
      hours: cfg.repeatDeployCooldownHours,
      base_mint: baseMint,
      reason: args.reason,
    });
  } catch (err) {
    ctx.logger.warn("cooldown", "pool-memory upsert failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
