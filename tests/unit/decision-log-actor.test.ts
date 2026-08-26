import { describe, it, expect } from "vitest";
import { executeTool } from "../../src/app/tools/execute.js";
import { createRegistry } from "../../src/app/tools/registry.js";
import { deployPositionTool } from "../../src/app/tools/impls/deploy-position.js";
import { closePositionTool } from "../../src/app/tools/impls/close-position.js";
import { createDryRunChainClient } from "../../src/adapters/chain/dry-run.js";
import { fixedClock } from "../../src/ports/clock.js";
import { makeCtx } from "./tool-context.js";

// Regression harness for the Sue-SOL 2026-08-26 incident: the deploy/close
// post-hooks used to hardcode actor="SCREENER" and always render the generic
// template, so every deploy looked daemon-authored and Sage's veto rationale
// never surfaced. deployMeta on ctx now scopes both.

const CLOCK = fixedClock("2026-07-05T12:00:00.000Z");
const REGISTRY = createRegistry([deployPositionTool, closePositionTool]);

const DEPLOY_ARGS = {
  pool_address: "goodPool",
  amount_sol: 0.5,
  strategy: "bid_ask" as const,
  bins_below: 40,
  bins_above: 10,
  base_mint: "MINT_G",
};

async function runDeploy(deployMeta?: { actor: "SCREENER" | "MANAGER" | "GENERAL" | "SAGE"; rationale?: string }) {
  const chain = createDryRunChainClient({ clock: CLOCK, seed: { walletSol: 5 } });
  const baseCtx = makeCtx({ chain });
  const ctx = deployMeta ? { ...baseCtx, deployMeta } : baseCtx;
  const r = await executeTool(REGISTRY, { name: "deploy_position", args: DEPLOY_ARGS }, ctx);
  expect(r.ok).toBe(true);
  const [entry] = await baseCtx.repos.decisions.recent(1);
  return entry!;
}

describe("decision log actor tagging (deployMeta)", () => {
  it("Sage bridge deploy → actor=SAGE, reason=rationale (not template)", async () => {
    const entry = await runDeploy({
      actor: "SAGE",
      rationale: "high fee/tvl, holders>1500, trend up 1h, vetoed 5m spike ok",
    });
    expect(entry.actor).toBe("SAGE");
    expect(entry.reason).toContain("high fee/tvl");
    expect(entry.reason).not.toMatch(/^deploy/i); // not the template
  });

  it("user chat bridge deploy → actor=GENERAL (cycle_id absent path)", async () => {
    const entry = await runDeploy({ actor: "GENERAL" });
    expect(entry.actor).toBe("GENERAL");
    expect(entry.reason.length).toBeGreaterThan(0); // template kicks in
  });

  it("local screener loop → actor=SCREENER + template reason (fallback path)", async () => {
    const entry = await runDeploy({ actor: "SCREENER" });
    expect(entry.actor).toBe("SCREENER");
  });

  it("no deployMeta on ctx → defaults to SCREENER (registered default)", async () => {
    const entry = await runDeploy();
    expect(entry.actor).toBe("SCREENER");
  });

  it("blank/whitespace rationale is ignored, template used instead", async () => {
    const entry = await runDeploy({ actor: "SAGE", rationale: "   " });
    expect(entry.actor).toBe("SAGE");
    // Falls through to formatDeployReason template; no crash, no empty reason.
    expect(entry.reason.length).toBeGreaterThan(0);
  });

  it("rationale is sanitized to 500 chars in the decision log", async () => {
    const long = "x".repeat(2000);
    const entry = await runDeploy({ actor: "SAGE", rationale: long });
    expect(entry.reason.length).toBeLessThanOrEqual(500);
  });
});

describe("decision log actor tagging — close_position", () => {
  it("Sage-authored close carries actor=SAGE + rationale", async () => {
    const chain = createDryRunChainClient({ clock: CLOCK, seed: { walletSol: 5 } });
    const ctx = makeCtx({ chain });
    // Deploy first (dry-run chain tracks the position id).
    const deploy = await executeTool(REGISTRY, { name: "deploy_position", args: DEPLOY_ARGS }, ctx);
    expect(deploy.ok).toBe(true);
    const snap = await ctx.chain.getMyPositions({ force: true });
    const pos = snap.positions[0]!.position;

    const closeCtx = {
      ...ctx,
      deployMeta: { actor: "SAGE" as const, rationale: "5m spike +40% → exit before mean-reversion" },
    };
    const r = await executeTool(
      REGISTRY,
      { name: "close_position", args: { position_address: pos, reason: "sage-veto" } },
      closeCtx,
    );
    expect(r.ok).toBe(true);
    const [entry] = await ctx.repos.decisions.recent(1);
    expect(entry?.type).toBe("close");
    expect(entry?.actor).toBe("SAGE");
    expect(entry?.reason).toContain("5m spike");
  });

  it("Manager deterministic close carries actor=MANAGER + plan.reason", async () => {
    const chain = createDryRunChainClient({ clock: CLOCK, seed: { walletSol: 5 } });
    const ctx = makeCtx({ chain });
    await executeTool(REGISTRY, { name: "deploy_position", args: DEPLOY_ARGS }, ctx);
    const snap = await ctx.chain.getMyPositions({ force: true });
    const pos = snap.positions[0]!.position;
    const mgmtCtx = {
      ...ctx,
      deployMeta: { actor: "MANAGER" as const, rationale: "stop-loss: pnl -20% ≤ -18%" },
    };
    const r = await executeTool(
      REGISTRY,
      { name: "close_position", args: { position_address: pos, reason: "det-rule" } },
      mgmtCtx,
    );
    expect(r.ok).toBe(true);
    const [entry] = await ctx.repos.decisions.recent(1);
    expect(entry?.actor).toBe("MANAGER");
    expect(entry?.reason).toContain("stop-loss");
  });
});
