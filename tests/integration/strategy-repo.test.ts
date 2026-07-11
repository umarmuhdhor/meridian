import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { createJsonStrategyRepo } from "../../src/adapters/persistence/json/strategy-repo.js";
import { nullLogger } from "../../src/ports/logger.js";
import { mkTmpDir, rmDir } from "./tmpdir.js";

const created: string[] = [];
afterEach(async () => {
  while (created.length) {
    const d = created.pop();
    if (d) await rmDir(d);
  }
});

describe("JsonStrategyRepo", () => {
  it("returns 5 defaults on missing file", async () => {
    const dir = await mkTmpDir("strat-def");
    created.push(dir);
    const repo = createJsonStrategyRepo({ filePath: path.join(dir, "s.json"), logger: nullLogger });
    const list = await repo.list();
    expect(list).toHaveLength(5);
    const active = await repo.getActive();
    expect(active?.id).toBe("custom_ratio_spot");
  });

  it("setActive succeeds for known id, fails for unknown", async () => {
    const dir = await mkTmpDir("strat-set");
    created.push(dir);
    const repo = createJsonStrategyRepo({ filePath: path.join(dir, "s.json"), logger: nullLogger });
    expect(await repo.setActive("fee_compounding")).toBe(true);
    expect((await repo.getActive())?.id).toBe("fee_compounding");
    expect(await repo.setActive("nope")).toBe(false);
  });

  it("upsert adds and remove clears", async () => {
    const dir = await mkTmpDir("strat-crud");
    created.push(dir);
    const repo = createJsonStrategyRepo({ filePath: path.join(dir, "s.json"), logger: nullLogger });
    await repo.upsert({
      id: "custom_x",
      name: "Custom X",
      author: null,
      lp_strategy: "spot",
      token_criteria: null,
      entry: null,
      range: null,
      exit: null,
      best_for: null,
      raw: null,
    });
    expect((await repo.list()).map((s) => s.id)).toContain("custom_x");
    expect(await repo.remove("custom_x")).toBe(true);
    expect((await repo.list()).map((s) => s.id)).not.toContain("custom_x");
  });
});
