import { describe, it, expect } from "vitest";
import { createRegistry } from "../../src/app/tools/registry.js";
import { executeTool } from "../../src/app/tools/execute.js";
import { getTopCandidatesTool } from "../../src/app/tools/impls/get-top-candidates.js";
import { searchPoolsTool } from "../../src/app/tools/impls/search-pools.js";
import { getTokenInfoTool } from "../../src/app/tools/impls/get-token-info.js";
import { getTokenHoldersTool } from "../../src/app/tools/impls/get-token-holders.js";
import { getTokenNarrativeTool } from "../../src/app/tools/impls/get-token-narrative.js";
import { checkSmartWalletsOnPoolTool } from "../../src/app/tools/impls/check-smart-wallets-on-pool.js";
import { createFakePoolDiscovery } from "../../src/adapters/market/fake-pool-discovery.js";
import { createFakeTokenInfo } from "../../src/adapters/market/fake-token-info.js";
import { createFakeSmartWalletChecker } from "../../src/adapters/market/fake-smart-wallet-checker.js";
import type { CandidatePool } from "../../src/domain/schemas/market.js";
import { makeCtx } from "./tool-context.js";

function pool(over: Partial<CandidatePool> = {}): CandidatePool {
  return {
    pool_address: "poolA",
    name: "TKN/SOL",
    base_mint: "MINT_A",
    quote_mint: "So11111111111111111111111111111111111111112",
    tvl: 50_000,
    active_tvl: 40_000,
    volume_window: 20_000,
    fee_active_tvl_ratio: 0.1,
    fee_tvl_ratio: 0.08,
    organic_score: 75,
    holders: 1200,
    mcap: 400_000,
    bin_step: 100,
    volatility: 0.05,
    launchpad: null,
    token_age_hours: 24,
    active_pct: 60,
    ...over,
  };
}

describe("get_top_candidates — end-to-end pipeline", () => {
  it("picks and ranks the passing pools", async () => {
    const pools = createFakePoolDiscovery({
      seed: [
        pool({ pool_address: "pA", name: "A/SOL", base_mint: "MA", organic_score: 65, fee_active_tvl_ratio: 0.06 }),
        pool({ pool_address: "pB", name: "B/SOL", base_mint: "MB", organic_score: 85, fee_active_tvl_ratio: 0.15 }),
        pool({ pool_address: "pC", name: "C/SOL", base_mint: "MC", tvl: 500 }), // rejected: tvl_out_of_range
      ],
    });
    const ctx = makeCtx({ market: { pools } });
    const r = await executeTool(createRegistry([getTopCandidatesTool]), {
      name: "get_top_candidates",
      args: { limit: 5, discover_limit: 20 },
    }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.value as {
      picked: Array<{ pool: CandidatePool; score: number; rank: number }>;
      scanned: number;
      passed: number;
      rejected: number;
      rejection_summary: string[];
    };
    expect(v.scanned).toBe(3);
    expect(v.passed).toBe(2);
    expect(v.rejected).toBe(1);
    expect(v.picked[0]?.pool.pool_address).toBe("pB"); // higher score
    expect(v.picked[1]?.pool.pool_address).toBe("pA");
    expect(v.rejection_summary[0]).toContain("tvl_out_of_range");
  });

  it("returns empty picked + rejection summary when everything rejects", async () => {
    const pools = createFakePoolDiscovery({
      seed: [pool({ tvl: 100 }), pool({ pool_address: "p2", tvl: 200 })],
    });
    const ctx = makeCtx({ market: { pools } });
    const r = await executeTool(createRegistry([getTopCandidatesTool]), {
      name: "get_top_candidates",
      args: {},
    }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.value as {
      picked: unknown[];
      passed: number;
      rejected: number;
      rejection_summary: string[];
    };
    expect(v.picked).toHaveLength(0);
    expect(v.passed).toBe(0);
    expect(v.rejected).toBe(2);
    expect(v.rejection_summary[0]).toContain("tvl_out_of_range");
  });

  it("respects tokenBlacklist repo — blacklisted mint rejected", async () => {
    const pools = createFakePoolDiscovery({
      seed: [pool({ base_mint: "MINT_BAD" })],
    });
    const ctx = makeCtx({ market: { pools } });
    await ctx.repos.tokenBlacklist.add("MINT_BAD", {
      symbol: null,
      reason: "test",
      added_at: "2026-07-05T12:00:00.000Z",
      added_by: "test",
    });
    const r = await executeTool(createRegistry([getTopCandidatesTool]), {
      name: "get_top_candidates",
      args: {},
    }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.value as { picked: unknown[]; rejection_summary: string[] };
    expect(v.picked).toHaveLength(0);
    expect(v.rejection_summary.some((s) => s.includes("base_mint_blacklisted"))).toBe(true);
  });
});

describe("search_pools", () => {
  it("substring match on name", async () => {
    const pools = createFakePoolDiscovery({
      seed: [pool({ pool_address: "p1", name: "BONK/SOL" }), pool({ pool_address: "p2", name: "WIF/SOL" })],
    });
    const ctx = makeCtx({ market: { pools } });
    const r = await executeTool(createRegistry([searchPoolsTool]), {
      name: "search_pools",
      args: { query: "bonk", limit: 5 },
    }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.value as { count: number; pools: Array<{ name: string }> };
    expect(v.count).toBe(1);
    expect(v.pools[0]?.name).toBe("BONK/SOL");
  });
});

describe("get_token_info / holders / narrative", () => {
  it("returns seeded token info", async () => {
    const tokenInfo = createFakeTokenInfo({
      info: {
        MINT_A: {
          mint: "MINT_A",
          symbol: "TKN",
          name: "Token A",
          launchpad: "pump.fun",
          deployer: "devX",
          supply: 1_000_000_000,
          mcap: 500_000,
          holders: 2400,
          age_hours: 6,
        },
      },
    });
    const ctx = makeCtx({ market: { tokenInfo } });
    const r = await executeTool(createRegistry([getTokenInfoTool]), {
      name: "get_token_info",
      args: { mint: "MINT_A" },
    }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = r.value as { symbol: string; mcap: number };
      expect(v.symbol).toBe("TKN");
      expect(v.mcap).toBe(500_000);
    }
  });

  it("returns empty defaults for unseeded mint", async () => {
    const ctx = makeCtx();
    const r = await executeTool(createRegistry([getTokenInfoTool]), {
      name: "get_token_info",
      args: { mint: "MINT_UNKNOWN" },
    }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = r.value as { mint: string; symbol: null };
      expect(v.mint).toBe("MINT_UNKNOWN");
      expect(v.symbol).toBeNull();
    }
  });

  it("holders returns summary", async () => {
    const tokenInfo = createFakeTokenInfo({
      holders: {
        MINT_A: {
          mint: "MINT_A",
          count: 3,
          top10_pct: 45,
          bot_pct: 12,
          top: [
            { address: "w1", pct: 25, amount: 250_000, label: "whale" },
            { address: "w2", pct: 15, amount: 150_000, label: null },
            { address: "w3", pct: 5, amount: 50_000, label: null },
          ],
        },
      },
    });
    const ctx = makeCtx({ market: { tokenInfo } });
    const r = await executeTool(createRegistry([getTokenHoldersTool]), {
      name: "get_token_holders",
      args: { mint: "MINT_A" },
    }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = r.value as { top10_pct: number; top: unknown[] };
      expect(v.top10_pct).toBe(45);
      expect(v.top).toHaveLength(3);
    }
  });

  it("narrative returns tags", async () => {
    const tokenInfo = createFakeTokenInfo({
      narrative: {
        MINT_A: { mint: "MINT_A", narrative: "dog meme cycle", tags: ["dog", "meme"] },
      },
    });
    const ctx = makeCtx({ market: { tokenInfo } });
    const r = await executeTool(createRegistry([getTokenNarrativeTool]), {
      name: "get_token_narrative",
      args: { mint: "MINT_A" },
    }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = r.value as { tags: string[] };
      expect(v.tags).toContain("meme");
    }
  });
});

describe("check_smart_wallets_on_pool", () => {
  it("returns matches from both pool + base_mint sources", async () => {
    const smartWalletChecker = createFakeSmartWalletChecker({
      matches: {
        poolA: [
          { name: "KOL1", address: "w1", category: "trader", type: "lp", matched_via: "position" },
        ],
      },
      matchesByMint: {
        MINT_A: [
          { name: "Whale1", address: "w2", category: null, type: "holder", matched_via: "holding" },
        ],
      },
    });
    const ctx = makeCtx({ market: { smartWalletChecker } });
    const r = await executeTool(createRegistry([checkSmartWalletsOnPoolTool]), {
      name: "check_smart_wallets_on_pool",
      args: { pool_address: "poolA", base_mint: "MINT_A" },
    }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = r.value as { count: number };
      expect(v.count).toBe(2);
    }
  });
});
