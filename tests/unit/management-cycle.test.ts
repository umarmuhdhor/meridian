import { describe, it, expect } from "vitest";
import { planForPosition, runManagementCycle } from "../../src/app/management/cycle.js";
import { createRegistry } from "../../src/app/tools/registry.js";
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
    const r = await runManagementCycle({ ctx, registry: REGISTRY });
    expect(r.kind).toBe("no_positions");
  });

  it("all_stay when no rule fires", async () => {
    const chain = createDryRunChainClient({
      clock: CLOCK,
      seed: { positions: [pos({ pnl_pct: 1, unclaimed_fees_usd: 1 })] },
    });
    const ctx = makeCtx({ chain });
    const r = await runManagementCycle({ ctx, registry: REGISTRY });
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
    expect(await positions.all()).toHaveLength(0);
    await runManagementCycle({ ctx, registry: REGISTRY });
    const tracked = await positions.all();
    expect(tracked).toHaveLength(1);
    expect(tracked[0]?.position).toBe("posA");
    expect(tracked[0]?.pool).toBe("poolA");
    expect(tracked[0]?.closed).toBe(false);
    expect(tracked[0]?.deployed_at).toBeTruthy();
  });

  it("executed: closes stop-loss position via direct tool call", async () => {
    const chain = createDryRunChainClient({
      clock: CLOCK,
      seed: { positions: [pos({ pnl_pct: -60 })] },
    });
    const ctx = makeCtx({ chain });
    const r = await runManagementCycle({ ctx, registry: REGISTRY });
    expect(r.kind).toBe("executed");
    if (r.kind === "executed") {
      const close = r.results.find((x) => x.plan.action === "CLOSE");
      expect(close?.ok).toBe(true);
      expect(r.plans.find((p) => p.action === "CLOSE")).toBeDefined();
    }
    const ds = await ctx.repos.decisions.recent(1);
    expect(ds[0]?.type).toBe("close");
  });

  it("executed: claims fees on CLAIM action via direct tool call", async () => {
    const chain = createDryRunChainClient({
      clock: CLOCK,
      seed: { positions: [pos({ unclaimed_fees_usd: 12 })] },
    });
    const ctx = makeCtx({ chain });
    const r = await runManagementCycle({ ctx, registry: REGISTRY });
    expect(r.kind).toBe("executed");
    if (r.kind === "executed") {
      const claim = r.results.find((x) => x.plan.action === "CLAIM");
      expect(claim?.ok).toBe(true);
    }
  });

  it("executed: closes MULTIPLE stop-loss positions in one tick (was capped at 1 by LLM once-per-session lock)", async () => {
    const chain = createDryRunChainClient({
      clock: CLOCK,
      seed: {
        positions: [
          pos({ position: "posA", pnl_pct: -60 }),
          pos({ position: "posB", pnl_pct: -70 }),
        ],
      },
    });
    const ctx = makeCtx({ chain });
    const r = await runManagementCycle({ ctx, registry: REGISTRY });
    expect(r.kind).toBe("executed");
    if (r.kind === "executed") {
      const closes = r.results.filter((x) => x.plan.action === "CLOSE" && x.ok);
      expect(closes).toHaveLength(2);
    }
  });
});
