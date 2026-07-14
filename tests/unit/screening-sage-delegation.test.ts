import { describe, it, expect } from "vitest";
import { runScreeningCycle } from "../../src/app/screening/cycle.js";
import { createRegistry } from "../../src/app/tools/registry.js";
import { createFakeLLM } from "../../src/adapters/llm/fake.js";
import { createFakePoolDiscovery } from "../../src/adapters/market/fake-pool-discovery.js";
import { createDryRunChainClient } from "../../src/adapters/chain/dry-run.js";
import { executeTool } from "../../src/app/tools/execute.js";
import { fixedClock } from "../../src/ports/clock.js";
import { getTopCandidatesTool } from "../../src/app/tools/impls/get-top-candidates.js";
import { getWalletBalanceTool } from "../../src/app/tools/impls/get-wallet-balance.js";
import { getMyPositionsTool } from "../../src/app/tools/impls/get-my-positions.js";
import { assertPoolDeployableTool } from "../../src/app/tools/impls/assert-pool-deployable.js";
import { deployPositionTool } from "../../src/app/tools/impls/deploy-position.js";
import type { SageDecider } from "../../src/ports/sage-decider.js";
import type { CandidatePool } from "../../src/domain/schemas/market.js";
import type { AppContext } from "../../src/app/tools/context.js";
import { makeCtx } from "./tool-context.js";

function pool(over: Partial<CandidatePool> = {}): CandidatePool {
  return {
    pool_address: "goodPool",
    name: "GOOD/SOL",
    base_mint: "MINT_G",
    quote_mint: "So11111111111111111111111111111111111111112",
    tvl: 50_000,
    active_tvl: 40_000,
    volume_window: 20_000,
    fee_active_tvl_ratio: 0.12,
    fee_tvl_ratio: 0.1,
    organic_score: 80,
    holders: 1500,
    mcap: 500_000,
    bin_step: 100,
    volatility: 0.05,
    launchpad: null,
    token_age_hours: 24,
    active_pct: 60,
    ...over,
  };
}

const REGISTRY = createRegistry([
  getTopCandidatesTool,
  getWalletBalanceTool,
  getMyPositionsTool,
  assertPoolDeployableTool,
  deployPositionTool,
]);
const CLOCK = fixedClock("2026-07-05T12:00:00.000Z");

const DEPLOY_ARGS = {
  pool_address: "goodPool",
  amount_sol: 0.5,
  strategy: "bid_ask" as const,
  bins_below: 40,
  bins_above: 10,
  base_mint: "MINT_G",
};

/** Fake Sage that actually deploys through the same ctx (simulates Sage → bridge). */
function deployingSage(ctx: AppContext, opts: { thenThrow?: boolean } = {}): SageDecider {
  return {
    async decide() {
      await executeTool(REGISTRY, { name: "deploy_position", args: DEPLOY_ARGS }, ctx);
      if (opts.thenThrow) throw new Error("network dropped after deploy");
      return { text: "deployed GOOD/SOL" };
    },
  };
}

function makeSetup() {
  const pools = createFakePoolDiscovery({ seed: [pool()] });
  const chain = createDryRunChainClient({ clock: CLOCK, seed: { walletSol: 5 } });
  const ctx = makeCtx({ chain, market: { pools } });
  return { ctx };
}

describe("runScreeningCycle — Sage delegation", () => {
  it("records delegated+deployed when Sage deploys via the bridge", async () => {
    const { ctx } = makeSetup();
    const llm = createFakeLLM({ script: [] }); // must NOT be used
    const outcome = await runScreeningCycle({
      ctx, llm, registry: REGISTRY, model: "test",
      decider: "sage", sage: deployingSage(ctx),
    });
    expect(outcome.kind).toBe("delegated");
    if (outcome.kind === "delegated") expect(outcome.deployed).toBe(true);
    const ds = await ctx.repos.decisions.recent(1);
    expect(ds[0]?.type).toBe("deploy"); // logged by the deploy tool post-hook, not us
  });

  it("records delegated no_deploy when Sage declines (no new position)", async () => {
    const { ctx } = makeSetup();
    const sage: SageDecider = { async decide() { return { text: "none qualify" }; } };
    const llm = createFakeLLM({ script: [] });
    const outcome = await runScreeningCycle({
      ctx, llm, registry: REGISTRY, model: "test", decider: "sage", sage,
    });
    expect(outcome.kind).toBe("delegated");
    if (outcome.kind === "delegated") expect(outcome.deployed).toBe(false);
    const ds = await ctx.repos.decisions.recent(1);
    expect(ds[0]?.type).toBe("no_deploy");
    expect(ds[0]?.reason).toContain("none qualify");
  });

  it("falls back to the local loop when Sage errors WITHOUT deploying", async () => {
    const { ctx } = makeSetup();
    const sage: SageDecider = { async decide() { throw new Error("sage down"); } };
    const llm = createFakeLLM({
      script: [
        { kind: "tool_calls", calls: [{ name: "deploy_position", args: DEPLOY_ARGS }] },
        { kind: "assistant", text: "deployed via fallback" },
      ],
    });
    const outcome = await runScreeningCycle({
      ctx, llm, registry: REGISTRY, model: "test", decider: "sage", sage,
    });
    expect(outcome.kind).toBe("invoked"); // fallback path
    if (outcome.kind === "invoked") {
      expect(outcome.agent.toolCalls.find((t) => t.name === "deploy_position")?.ok).toBe(true);
    }
  });

  it("does NOT fall back (no double deploy) when Sage errors AFTER deploying", async () => {
    const { ctx } = makeSetup();
    // llm would deploy AGAIN if the fallback wrongly ran — it must not.
    const llm = createFakeLLM({
      script: [
        { kind: "tool_calls", calls: [{ name: "deploy_position", args: DEPLOY_ARGS }] },
        { kind: "assistant", text: "SHOULD NOT RUN" },
      ],
    });
    const outcome = await runScreeningCycle({
      ctx, llm, registry: REGISTRY, model: "test",
      decider: "sage", sage: deployingSage(ctx, { thenThrow: true }),
    });
    expect(outcome.kind).toBe("delegated");
    if (outcome.kind === "delegated") expect(outcome.deployed).toBe(true);
    const snap = await ctx.chain.getMyPositions({ force: true });
    expect(snap.total_positions).toBe(1); // exactly one deploy, not two
  });

  it("stays on the local loop when no decider configured (default unchanged)", async () => {
    const { ctx } = makeSetup();
    const llm = createFakeLLM({
      script: [
        { kind: "tool_calls", calls: [{ name: "deploy_position", args: DEPLOY_ARGS }] },
        { kind: "assistant", text: "deployed" },
      ],
    });
    const outcome = await runScreeningCycle({ ctx, llm, registry: REGISTRY, model: "test" });
    expect(outcome.kind).toBe("invoked");
  });
});
