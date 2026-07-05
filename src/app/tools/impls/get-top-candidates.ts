import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { CandidatePoolSchema } from "../../../domain/schemas/market.js";
import {
  defaultThresholds,
  hardFilter,
  rankCandidates,
  summarizeRejections,
  type ScreeningThresholds,
} from "../../../domain/rules/screening.js";
import { isBaseMintOnCooldown, isPoolOnCooldown } from "../../../domain/rules/cooldown.js";

const ScoredPoolSchema = z.object({
  pool: CandidatePoolSchema,
  score: z.number(),
  rank: z.number().int().positive(),
});

export const getTopCandidatesTool = defineTool({
  name: "get_top_candidates",
  description:
    "Run the full screening pipeline: pull raw pools from the discovery source, apply hard filters (TVL, volume, organic, holders, mcap, bin step, fee/TVL, launchpad, token age, pool + base-mint cooldowns, blacklist, in-use mints), rank by score. Returns the top candidates plus a summary of rejection reasons.",
  args: z.object({
    limit: z.number().int().positive().max(20).default(5),
    discover_limit: z.number().int().positive().max(200).default(50),
  }),
  result: z.object({
    picked: z.array(ScoredPoolSchema),
    scanned: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    rejection_summary: z.array(z.string()),
  }),
  execute: async ({ limit, discover_limit }, ctx) => {
    const rawPools = await ctx.market.pools.discover({ limit: discover_limit });

    // Preload cooldown DB + open-position base mints once.
    const poolMemoryDb = await ctx.repos.poolMemory.load();
    const db = poolMemoryDb.ok ? poolMemoryDb.value : {};
    const openPositions = await ctx.chain.getMyPositions();
    const baseMintsInUse = new Set(
      openPositions.positions.map((p) => p.base_mint).filter((m): m is string => !!m),
    );
    const blacklistSnapshot = await ctx.repos.tokenBlacklist.load();
    const bl = blacklistSnapshot.ok ? blacklistSnapshot.value : {};
    const now = ctx.clock.now();

    const th: ScreeningThresholds = defaultThresholds(ctx.config);

    const { passed, rejected } = hardFilter(rawPools, th, {
      onPoolCooldown: (p) => isPoolOnCooldown(db[p.pool_address], now),
      onBaseMintCooldown: (p) => isBaseMintOnCooldown(db, p.base_mint, now),
      isBlacklisted: (mint) => Object.prototype.hasOwnProperty.call(bl, mint),
      baseMintsInUse,
    });

    const ranked = rankCandidates(passed);
    const picked = ranked.slice(0, limit).map((r, i) => ({
      pool: r.pool,
      score: r.score,
      rank: i + 1,
    }));

    return {
      picked,
      scanned: rawPools.length,
      passed: passed.length,
      rejected: rejected.length,
      rejection_summary: summarizeRejections(rejected),
    };
  },
});
