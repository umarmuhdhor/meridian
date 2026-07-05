import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { createJsonTokenBlacklistRepo } from "../../src/adapters/persistence/json/token-blacklist-repo.js";
import { nullLogger } from "../../src/ports/logger.js";
import { mkTmpDir, rmDir } from "./tmpdir.js";

const created: string[] = [];
afterEach(async () => {
  while (created.length) {
    const d = created.pop();
    if (d) await rmDir(d);
  }
});

describe("JsonTokenBlacklistRepo", () => {
  it("add + isBlacklisted + remove", async () => {
    const dir = await mkTmpDir("bl");
    created.push(dir);
    const repo = createJsonTokenBlacklistRepo({ filePath: path.join(dir, "b.json"), logger: nullLogger });
    expect(await repo.isBlacklisted("MINT_X")).toBe(false);
    await repo.add("MINT_X", { symbol: "X", reason: "rug", added_at: "2026-07-05T12:00:00.000Z", added_by: "test" });
    expect(await repo.isBlacklisted("MINT_X")).toBe(true);
    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.mint).toBe("MINT_X");
    expect(await repo.remove("MINT_X")).toBe(true);
    expect(await repo.isBlacklisted("MINT_X")).toBe(false);
    expect(await repo.remove("MINT_X")).toBe(false);
  });
});
