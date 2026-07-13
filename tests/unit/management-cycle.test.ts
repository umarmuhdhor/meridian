import { describe, it, expect } from "vitest";
import { planForPosition, runManagementCycle } from "../../src/app/management/cycle.js";
import { createRegistry } from "../../src/app/tools/registry.js";
import { createFakeLLM } from "../../src/adapters/llm/fake.js";
import { createDryRunChainClient } from "../../src/adapters/chain/dry-run.js";
import { fixedClock } from "../../src/ports/clock.js";
import { closePositionTool } from "../../src/app/tools/impls/close-position.js";
import { claimFeesTool } from "../../src/app/tools/impls/claim-fees.js";
import { getMyPositionsTool } from "../../src/app/tools/impls/get-my-positions.js";
import { getWalletBalanceTool } from "../../src/app/tools/impls/get-wallet-balance.js";
import type { OnChainPosition } from "../../src/domain/schemas/chain.js";
import type { TrackedPosition } from "../../src/domain/schemas/position.js";
import type { PositionRepo } from "../../src/ports/position-repo.js";
import { makeCtx } from "./tool-context.js";

function statefulPositionRepo(): PositionRepo {
  const store = new Map<string, TrackedPosition>();
  return {
    async load() {
      return { ok: true, value: { positions: {}, recentEvents: [], lastUpdated: null } };
    },
    async save() {},
    async pushEvent() {},
    async get(a) {
      return store.get(a) ?? null;
    },
    async all() {
      return [...store.values()];
    },
    async upsert(p) {
      store.set(p.position, p);
    },
  };
}
import { mgmt } from "./fixtures.js";

const REGISTRY = createRegistry([
  closePositionTool,
  claimFeesTool,
  getMyPositionsTool,
  getWalletBalanceTool,
]);

const CLOCK = fixedClock("2026-07-05T12:00:00.000Z");

function pos(over: Partial<OnChainPosition> = {}): OnChainPosition {
  return {
    position: "posA",
    pool: "poolA",
    pair: "TKN/SOL",
    base_mint: "MINT_A",
    lower_bin: 90,
    upper_bin: 110,
    active_bin: 100,
    in_range: true,
    unclaimed_fees_usd: 0,
    pnl_pct: 0,
    pnl_pct_suspicious: false,
    total_value_usd: 100,
    fee_per_tvl_24h: 10,
    age_minutes: 120,
    minutes_out_of_range: 0,
    ...over,
  };
}

describe("planForPosition", () => {
  it("CLOSE on stop loss", () => {
    const p = planForPosition(pos({ pnl_pct: -60 }), { config: { management: mgmt } as never });
    expect(p.action).toBe("CLOSE");
    expect(p.reason).toBe("stop loss");
  });

  it("CLAIM when unclaimed_fees ≥ minClaimAmount and no close rule fires", () => {
    const p = planForPosition(pos({ unclaimed_fees_usd: 10 }), { config: { management: mgmt } as never });
    expect(p.action).toBe("CLAIM");
    expect(p.reason).toContain("10.00");
  });

  it("STAY when nothing fires", () => {
    const p = planForPosition(pos({ unclaimed_fees_usd: 1, pnl_pct: 1 }), { config: { management: mgmt } as never });
    expect(p.action).toBe("STAY");
  });

  it("CLOSE takes precedence over CLAIM", () => {
    const p = planForPosition(pos({ pnl_pct: 10, unclaimed_fees_usd: 10 }), { config: { management: mgmt } as never });
    expect(p.action).toBe("CLOSE");
    expect(p.reason).toBe("take profit");
  });
});

describe("runManagementCycle", () => {
  it("no_positions when wallet has none", async () => {
    const chain = createDryRunChainClient({ clock: CLOCK });
    const ctx = makeCtx({ chain });
    const llm = createFakeLLM({ script: [] });
    const r = await runManagementCycle({ ctx, llm, registry: REGISTRY, model: "test" });
    expect(r.kind).toBe("no_positions");
  });

  it("all_stay: LLM never invoked", async () => {
    const chain = createDryRunChainClient({
      clock: CLOCK,
      seed: { positions: [pos({ pnl_pct: 1, unclaimed_fees_usd: 1 })] },
    });
    const ctx = makeCtx({ chain });
    const llm = createFakeLLM({ script: [] }); // empty script — throws if called
    const r = await runManagementCycle({ ctx, llm, registry: REGISTRY, model: "test" });
    expect(r.kind).toBe("all_stay");
    if (r.kind === "all_stay") expect(r.positions).toBe(1);
  });

  it("reconciles an untracked on-chain position into the tracking store", async () => {
    const chain = createDryRunChainClient({
      clock: CLOCK,
      seed: { positions: [pos({ pnl_pct: 1, unclaimed_fees_usd: 0 })] },
    });
    const positions = statefulPositionRepo();
    const ctx = makeCtx({ chain, repos: { positions } });
    const llm = createFakeLLM({ script: [] }); // all STAY → LLM never invoked
    expect(await positions.all()).toHaveLength(0);
    await runManagementCycle({ ctx, llm, registry: REGISTRY, model: "test" });
    const tracked = await positions.all();
    expect(tracked).toHaveLength(1);
    expect(tracked[0]?.position).toBe("posA");
    expect(tracked[0]?.pool).toBe("poolA");
    expect(tracked[0]?.closed).toBe(false);
    expect(tracked[0]?.deployed_at).toBeTruthy();
  });

  it("invoked: agent runs and closes stop-loss position", async () => {
    const chain = createDryRunChainClient({
      clock: CLOCK,
      seed: { positions: [pos({ pnl_pct: -60 })] },
    });
    const ctx = makeCtx({ chain });
    const llm = createFakeLLM({
      script: [
        {
          kind: "tool_calls",
          calls: [{ name: "close_position", args: { position_address: "posA", reason: "stop loss" } }],
        },
        { kind: "assistant", text: "closed" },
      ],
    });
    const r = await runManagementCycle({ ctx, llm, registry: REGISTRY, model: "test" });
    expect(r.kind).toBe("invoked");
    if (r.kind === "invoked") {
      const close = r.agent.toolCalls.find((t) => t.name === "close_position");
      expect(close?.ok).toBe(true);
      expect(r.plans.find((p) => p.action === "CLOSE")).toBeDefined();
    }
    // Post-hook wrote decision entry
    const ds = await ctx.repos.decisions.recent(1);
    expect(ds[0]?.type).toBe("close");
  });

  it("invoked: agent claims fees on CLAIM action", async () => {
    const chain = createDryRunChainClient({
      clock: CLOCK,
      seed: { positions: [pos({ unclaimed_fees_usd: 12 })] },
    });
    const ctx = makeCtx({ chain });
    const llm = createFakeLLM({
      script: [
        {
          kind: "tool_calls",
          calls: [{ name: "claim_fees", args: { position_address: "posA" } }],
        },
        { kind: "assistant", text: "claimed" },
      ],
    });
    const r = await runManagementCycle({ ctx, llm, registry: REGISTRY, model: "test" });
    expect(r.kind).toBe("invoked");
    if (r.kind === "invoked") {
      const claim = r.agent.toolCalls.find((t) => t.name === "claim_fees");
      expect(claim?.ok).toBe(true);
    }
  });
});
