import { describe, it, expect } from "vitest";
import { createRegistry } from "../../src/app/tools/registry.js";
import { executeTool } from "../../src/app/tools/execute.js";
import { getPoolMemoryTool } from "../../src/app/tools/impls/get-pool-memory.js";
import { assertPoolDeployableTool } from "../../src/app/tools/impls/assert-pool-deployable.js";
import type { PoolMemoryEntry } from "../../src/domain/schemas/pool-memory.js";
import { makeCtx, memPoolMemoryRepo, memPositionRepo } from "./tool-context.js";
import { fixedClock } from "../../src/ports/clock.js";
import { nullLogger } from "../../src/ports/logger.js";

const NOW = "2026-07-05T12:00:00.000Z";
const FUTURE = "2026-07-05T18:00:00.000Z";

const knownEntry: PoolMemoryEntry = {
  name: "TKN/SOL",
  base_mint: "MINT_A",
  deploys: Array.from({ length: 15 }, (_, i) => ({
    deployed_at: `2026-07-01T0${i % 10}:00:00.000Z`,
    closed_at: `2026-07-01T0${(i % 10) + 1}:00:00.000Z`,
    pnl_pct: i - 5,
    close_reason: "manual",
  })),
  total_deploys: 15,
  avg_pnl_pct: 2.5,
  win_rate: 0.6,
  adjusted_win_rate: 0.55,
  adjusted_win_rate_sample_count: 12,
  last_deployed_at: "2026-07-04T00:00:00.000Z",
  last_outcome: "win",
  cooldown_until: FUTURE,
  cooldown_reason: "low yield",
  base_mint_cooldown_until: null,
  base_mint_cooldown_reason: null,
  notes: ["prior loss on OOR"],
  snapshots: [],
};

function ctxWith(seed: Record<string, PoolMemoryEntry>) {
  const poolMemory = memPoolMemoryRepo(seed);
  return makeCtx({
    clock: fixedClock(NOW),
    logger: nullLogger,
    repos: { positions: memPositionRepo(), poolMemory },
  });
}

describe("get_pool_memory tool", () => {
  it("returns known=false for unseen pool", async () => {
    const ctx = ctxWith({});
    const r = await executeTool(createRegistry([getPoolMemoryTool]), {
      name: "get_pool_memory",
      args: { pool_address: "poolA" },
    }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = r.value as { known: boolean; message: string };
      expect(v.known).toBe(false);
      expect(v.message).toMatch(/first time/i);
    }
  });

  it("returns known=true with capped history for known pool", async () => {
    const ctx = ctxWith({ poolA: knownEntry });
    const r = await executeTool(createRegistry([getPoolMemoryTool]), {
      name: "get_pool_memory",
      args: { pool_address: "poolA" },
    }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = r.value as { known: boolean; name: string; history_count: number; cooldown_until: string | null };
      expect(v.known).toBe(true);
      expect(v.name).toBe("TKN/SOL");
      expect(v.history_count).toBe(10);
      expect(v.cooldown_until).toBe(FUTURE);
    }
  });

  it("rejects missing pool_address at args validation", async () => {
    const ctx = ctxWith({});
    const r = await executeTool(createRegistry([getPoolMemoryTool]), {
      name: "get_pool_memory",
      args: {},
    }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("args_invalid");
  });
});

describe("assert_pool_deployable tool (safety chain integration)", () => {
  it("passes when no cooldown active", async () => {
    const ctx = ctxWith({});
    const r = await executeTool(createRegistry([assertPoolDeployableTool]), {
      name: "assert_pool_deployable",
      args: { pool_address: "poolA" },
    }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as { deployable: boolean }).deployable).toBe(true);
  });

  it("safety_blocked when pool cooldown active", async () => {
    const ctx = ctxWith({ poolA: knownEntry });
    const r = await executeTool(createRegistry([assertPoolDeployableTool]), {
      name: "assert_pool_deployable",
      args: { pool_address: "poolA" },
    }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "safety_blocked") {
      expect(r.error.reason).toMatch(/cooldown/);
    } else {
      throw new Error("expected safety_blocked");
    }
  });

  it("safety_blocked when base_mint cooldown active anywhere in DB", async () => {
    const otherPool: PoolMemoryEntry = {
      ...knownEntry,
      name: "OTHER",
      cooldown_until: null,
      base_mint_cooldown_until: FUTURE,
    };
    const ctx = ctxWith({ poolOther: otherPool });
    const r = await executeTool(createRegistry([assertPoolDeployableTool]), {
      name: "assert_pool_deployable",
      args: { pool_address: "poolNew", base_mint: "MINT_A" },
    }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "safety_blocked") {
      expect(r.error.reason).toMatch(/base mint/);
    } else {
      throw new Error("expected safety_blocked");
    }
  });
});
