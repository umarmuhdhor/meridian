import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { createJsonPoolMemoryRepo } from "../../src/adapters/persistence/json/pool-memory-repo.js";
import { nullLogger } from "../../src/ports/logger.js";
import type { PoolMemoryEntry } from "../../src/domain/schemas/pool-memory.js";
import { mkTmpDir, rmDir } from "./tmpdir.js";

const created: string[] = [];

afterEach(async () => {
  while (created.length) {
    const d = created.pop();
    if (d) await rmDir(d);
  }
});

function entry(over: Partial<PoolMemoryEntry> = {}): PoolMemoryEntry {
  return {
    name: "TKN/SOL",
    base_mint: "MINT_A",
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
    ...over,
  };
}

describe("JsonPoolMemoryRepo", () => {
  it("returns empty db on missing file", async () => {
    const dir = await mkTmpDir("pm-empty");
    created.push(dir);
    const repo = createJsonPoolMemoryRepo({ filePath: path.join(dir, "pm.json"), logger: nullLogger });
    const r = await repo.load();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({});
  });

  it("upsert + get", async () => {
    const dir = await mkTmpDir("pm-upsert");
    created.push(dir);
    const repo = createJsonPoolMemoryRepo({ filePath: path.join(dir, "pm.json"), logger: nullLogger });
    await repo.upsert("pool1", entry({ name: "FOO/SOL", total_deploys: 5 }));
    const fetched = await repo.get("pool1");
    expect(fetched?.name).toBe("FOO/SOL");
    expect(fetched?.total_deploys).toBe(5);
  });

  it("get returns null for unknown pool", async () => {
    const dir = await mkTmpDir("pm-missing");
    created.push(dir);
    const repo = createJsonPoolMemoryRepo({ filePath: path.join(dir, "pm.json"), logger: nullLogger });
    expect(await repo.get("nope")).toBeNull();
  });
});
