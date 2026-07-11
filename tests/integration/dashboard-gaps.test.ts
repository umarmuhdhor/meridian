import { describe, expect, it } from "vitest";
import { createRegistry } from "../../src/app/tools/registry.js";
import { executeTool } from "../../src/app/tools/execute.js";
import { makeCtx } from "../unit/tool-context.js";
import { createFakeTokenInfo } from "../../src/adapters/market/fake-token-info.js";
import { createFakeStudy } from "../../src/adapters/market/fake-study.js";
import { deployPositionTool } from "../../src/app/tools/impls/deploy-position.js";
import { getTopLpersTool } from "../../src/app/tools/impls/get-top-lpers.js";
import { studyTopLpersTool } from "../../src/app/tools/impls/study-top-lpers.js";
import { assembleWalletBalance } from "../../src/adapters/dashboard/wallet-balance.js";
import type { ChainClient } from "../../src/ports/chain-client.js";
import type { AppContext } from "../../src/app/tools/context.js";

const deployArgs = {
  pool_address: "PoolAAA",
  amount_sol: 0.5,
  strategy: "bid_ask" as const,
  bins_below: 40,
  base_mint: "MintAAA",
  pool_name: "AAA/SOL",
};

describe("gap 2 — dev-blocklist enforced at deploy", () => {
  it("blocks a deploy when the token deployer is on the dev-blocklist", async () => {
    const tokenInfo = createFakeTokenInfo({
      info: {
        MintAAA: {
          mint: "MintAAA", symbol: "AAA", name: "AAA", launchpad: null,
          deployer: "DevBadWallet", supply: null, mcap: null, holders: null, age_hours: null,
        },
      },
    });
    const ctx = makeCtx({ market: { tokenInfo } });
    await ctx.repos.devBlocklist.add("DevBadWallet", {
      reason: "rug", added_at: "2026-07-05T00:00:00.000Z", added_by: "test",
    });
    const reg = createRegistry([deployPositionTool]);
    const r = await executeTool(reg, { name: "deploy_position", args: deployArgs }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("safety_blocked");
  });

  it("allows a deploy when the deployer is clean", async () => {
    const tokenInfo = createFakeTokenInfo({
      info: {
        MintAAA: {
          mint: "MintAAA", symbol: "AAA", name: "AAA", launchpad: null,
          deployer: "DevGoodWallet", supply: null, mcap: null, holders: null, age_hours: null,
        },
      },
    });
    const ctx = makeCtx({ market: { tokenInfo } });
    const reg = createRegistry([deployPositionTool]);
    const r = await executeTool(reg, { name: "deploy_position", args: deployArgs }, ctx);
    // Not blocked by the deployer gate (dry-run chain performs the deploy).
    expect(r.ok).toBe(true);
  });
});

describe("gap 3 — wallet multi-token balance", () => {
  const baseChain = (): ChainClient => makeCtx().chain;

  it("includes tokens + total_usd when the chain exposes getWalletTokens", async () => {
    const chain: ChainClient = {
      ...baseChain(),
      async getWalletBalance() {
        return { sol: 2, sol_usd: 300, sol_price: 150, fetched_at: "2026-07-05T00:00:00.000Z" };
      },
      async getWalletTokens() {
        return [
          { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", balance: 50, usd: 50 },
          { mint: "MintXYZ", symbol: null, balance: 1000, usd: 25 },
        ];
      },
    };
    const bal = await assembleWalletBalance(chain);
    expect(bal.tokens).toHaveLength(2);
    expect(bal.usdc).toBe(50);
    expect(bal.total_usd).toBe(375); // 300 + 50 + 25
  });

  it("degrades to SOL-only when getWalletTokens is absent", async () => {
    const chain: ChainClient = {
      ...baseChain(),
      async getWalletBalance() {
        return { sol: 1, sol_usd: 150, sol_price: 150, fetched_at: "2026-07-05T00:00:00.000Z" };
      },
    };
    delete (chain as { getWalletTokens?: unknown }).getWalletTokens;
    const bal = await assembleWalletBalance(chain);
    expect(bal.tokens).toEqual([]);
    expect(bal.total_usd).toBe(150);
  });
});

describe("gap 1 — study tools", () => {
  const run = (ctx: AppContext, name: string) =>
    executeTool(createRegistry([getTopLpersTool, studyTopLpersTool]), { name, args: {} }, ctx);

  it("get_top_lpers returns the study source's ranked LP-ers", async () => {
    const study = createFakeStudy({
      top: { lpers: [{ address: "Lp1", win_rate: 0.7 }], count: 1 },
    });
    const ctx = makeCtx({ market: { study } });
    const r = await run(ctx, "get_top_lpers");
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as { count: number }).count).toBe(1);
  });

  it("study_top_lpers returns patterns + summary", async () => {
    const study = createFakeStudy({
      study: { lpers: [], summary: "hold long", patterns: ["prefer bid_ask"] },
    });
    const ctx = makeCtx({ market: { study } });
    const r = await run(ctx, "study_top_lpers");
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as { patterns: string[] }).patterns).toContain("prefer bid_ask");
  });

  it("empty study source is handled (no throw)", async () => {
    const ctx = makeCtx();
    const r = await run(ctx, "get_top_lpers");
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as { count: number }).count).toBe(0);
  });
});
