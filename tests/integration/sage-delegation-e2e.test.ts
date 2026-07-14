// End-to-end: runScreeningCycle (decider=sage) → real SageDeciderHttp → a fake Sage
// HTTP server that calls BACK into the real Meridian dashboard bridge to deploy (with
// the cycle_id) → executeTool → dry-run chain. Exercises the whole Path 2 loop over
// real HTTP, in-process, with zero on-chain risk. This is the dryrun gate from the
// plan, runnable without the prod VPS.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { startBridge, type BridgeHandle } from "../../src/adapters/dashboard/server.js";
import { runScreeningCycle } from "../../src/app/screening/cycle.js";
import { createRegistry } from "../../src/app/tools/registry.js";
import { createSageDeciderHttp } from "../../src/adapters/llm/sage-decider-http.js";
import { createFakeLLM } from "../../src/adapters/llm/fake.js";
import { createFakePoolDiscovery } from "../../src/adapters/market/fake-pool-discovery.js";
import { createDryRunChainClient } from "../../src/adapters/chain/dry-run.js";
import { fixedClock } from "../../src/ports/clock.js";
import { getTopCandidatesTool } from "../../src/app/tools/impls/get-top-candidates.js";
import { getWalletBalanceTool } from "../../src/app/tools/impls/get-wallet-balance.js";
import { getMyPositionsTool } from "../../src/app/tools/impls/get-my-positions.js";
import { assertPoolDeployableTool } from "../../src/app/tools/impls/assert-pool-deployable.js";
import { deployPositionTool } from "../../src/app/tools/impls/deploy-position.js";
import type { CandidatePool } from "../../src/domain/schemas/market.js";
import { makeCtx } from "../unit/tool-context.js";
import { mkTmpDir, rmDir } from "./tmpdir.js";

const BRIDGE_PORT = 8795;
const SAGE_PORT = 8796;
const TOKEN = "e2e-bridge-token";
const CLOCK = fixedClock("2026-07-05T12:00:00.000Z");

function pool(): CandidatePool {
  return {
    pool_address: "goodPool", name: "GOOD/SOL", base_mint: "MINT_G",
    quote_mint: "So11111111111111111111111111111111111111112",
    tvl: 50_000, active_tvl: 40_000, volume_window: 20_000,
    fee_active_tvl_ratio: 0.12, fee_tvl_ratio: 0.1, organic_score: 80,
    holders: 1500, mcap: 500_000, bin_step: 100, volatility: 0.05,
    launchpad: null, token_age_hours: 24, active_pct: 60,
  };
}

/** Fake Sage: on chat/completions, extract cycle_id and deploy via the REAL bridge. */
function startFakeSage(deployAttempts: string[]): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    void (async () => {
      let raw = "";
      for await (const c of req) raw += c;
      const body = JSON.parse(raw) as { messages: Array<{ content: string }> };
      const userMsg = body.messages[body.messages.length - 1]?.content ?? "";
      const cycleId = /cycle_id:\s*(\S+)/.exec(userMsg)?.[1];
      // Call back into the Meridian bridge to actually deploy.
      const r = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          name: "deploy_position",
          confirm: true,
          cycle_id: cycleId,
          args: {
            pool_address: "goodPool", amount_sol: 0.5, strategy: "bid_ask",
            bins_below: 40, bins_above: 10, base_mint: "MINT_G",
          },
        }),
      });
      deployAttempts.push(`${r.status}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "deployed GOOD/SOL via bridge" } }] }));
    })();
  });
  return new Promise((resolve) => server.listen(SAGE_PORT, "127.0.0.1", () => resolve(server)));
}

describe("Sage delegation E2E (bridge + fake Sage over real HTTP)", () => {
  let bridge: BridgeHandle | null = null;
  let sage: http.Server;
  let stateDir: string;
  let ctx: ReturnType<typeof makeCtx>;
  const deployAttempts: string[] = [];
  const REGISTRY = createRegistry([
    getTopCandidatesTool, getWalletBalanceTool, getMyPositionsTool,
    assertPoolDeployableTool, deployPositionTool,
  ]);

  beforeAll(async () => {
    stateDir = await mkTmpDir("sage-e2e");
    const chain = createDryRunChainClient({ clock: CLOCK, seed: { walletSol: 5 } });
    const pools = createFakePoolDiscovery({ seed: [pool()] });
    ctx = makeCtx({ chain, market: { pools } });
    bridge = startBridge({
      port: BRIDGE_PORT, token: TOKEN, ctx,
      llm: createFakeLLM({ script: [], model: "demo/fake-v1" }),
      registry: REGISTRY, model: "demo/fake-v1", stateDir,
    });
    sage = await startFakeSage(deployAttempts);
    await new Promise((r) => setTimeout(r, 100));
  });

  afterAll(async () => {
    if (bridge) await bridge.close();
    await new Promise<void>((r) => sage.close(() => r()));
    await rmDir(stateDir);
  });

  it("delegates → Sage deploys via the bridge → Meridian detects the deploy", async () => {
    const sageDecider = createSageDeciderHttp({
      baseUrl: `http://127.0.0.1:${SAGE_PORT}`, apiKey: "x",
    });
    const outcome = await runScreeningCycle({
      ctx, llm: createFakeLLM({ script: [] }), registry: REGISTRY, model: "test",
      decider: "sage", sage: sageDecider, sageSessionKey: "meridian-trading", sageTimeoutMs: 5000,
    });
    expect(outcome.kind).toBe("delegated");
    if (outcome.kind === "delegated") expect(outcome.deployed).toBe(true);
    // Sage's bridge deploy returned 200 (not 409/403).
    expect(deployAttempts).toContain("200");
    // A real position landed on the (dry-run) chain.
    const snap = await ctx.chain.getMyPositions({ force: true });
    expect(snap.total_positions).toBe(1);
    // The deploy decision was logged by the bridge post-hook, not the cycle.
    const ds = await ctx.repos.decisions.recent(1);
    expect(ds[0]?.type).toBe("deploy");
  });

  it("rejects a duplicate cycle_id over HTTP (no double deploy)", async () => {
    const deploy = (cycleId: string) =>
      fetch(`http://127.0.0.1:${BRIDGE_PORT}/tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          name: "deploy_position",
          args: { pool_address: "goodPool", amount_sol: 0.5, strategy: "bid_ask", bins_below: 40, bins_above: 10, base_mint: "MINT_G" },
          confirm: true,
          cycle_id: cycleId,
        }),
      });
    const first = await deploy("e2e-idem");
    expect(first.status).toBe(200);
    expect(((await first.json()) as { ok: boolean }).ok).toBe(true);
    // Same cycle_id again → rejected before executing → exactly one deploy from this pair.
    const second = await deploy("e2e-idem");
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toMatch(/duplicate/);
  });
});
