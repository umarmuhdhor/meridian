import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createJsonPositionRepo } from "../../src/adapters/persistence/json/position-repo.js";
import { fixedClock } from "../../src/ports/clock.js";
import { nullLogger } from "../../src/ports/logger.js";
import { makeTracked } from "../unit/fixtures.js";
import { mkTmpDir, rmDir } from "./tmpdir.js";

const created: string[] = [];
const clock = fixedClock("2026-07-05T12:00:00.000Z");

afterEach(async () => {
  while (created.length) {
    const d = created.pop();
    if (d) await rmDir(d);
  }
});

describe("JsonPositionRepo", () => {
  it("returns empty state on missing file", async () => {
    const dir = await mkTmpDir("state");
    created.push(dir);
    const repo = createJsonPositionRepo({ filePath: path.join(dir, "state.json"), clock, logger: nullLogger });
    const r = await repo.load();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.positions).toEqual({});
      expect(r.value.recentEvents).toEqual([]);
    }
  });

  it("upsert + get round-trip", async () => {
    const dir = await mkTmpDir("state-upsert");
    created.push(dir);
    const file = path.join(dir, "state.json");
    const repo = createJsonPositionRepo({ filePath: file, clock, logger: nullLogger });
    const pos = makeTracked({ position: "posX", pool: "poolX" });
    await repo.upsert(pos);
    const fetched = await repo.get("posX");
    expect(fetched?.pool).toBe("poolX");
    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    expect(raw.lastUpdated).toBe("2026-07-05T12:00:00.000Z");
  });

  it("all(openOnly=true) filters closed positions", async () => {
    const dir = await mkTmpDir("state-open");
    created.push(dir);
    const repo = createJsonPositionRepo({ filePath: path.join(dir, "state.json"), clock, logger: nullLogger });
    await repo.upsert(makeTracked({ position: "open1" }));
    await repo.upsert(makeTracked({ position: "closed1", closed: true, closed_at: "2026-07-05T11:00:00.000Z" }));
    const open = await repo.all(true);
    expect(open.map((p) => p.position)).toEqual(["open1"]);
    const all = await repo.all();
    expect(all).toHaveLength(2);
  });

  it("pushEvent caps at 20 entries", async () => {
    const dir = await mkTmpDir("state-events");
    created.push(dir);
    const repo = createJsonPositionRepo({ filePath: path.join(dir, "state.json"), clock, logger: nullLogger });
    for (let i = 0; i < 25; i += 1) {
      await repo.pushEvent({ ts: `2026-07-05T12:00:${String(i).padStart(2, "0")}.000Z`, action: "test" });
    }
    const r = await repo.load();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.recentEvents).toHaveLength(20);
      expect(r.value.recentEvents[0]?.ts).toBe("2026-07-05T12:00:05.000Z");
    }
  });

  it("surfaces error on corrupt file", async () => {
    const dir = await mkTmpDir("state-corrupt");
    created.push(dir);
    const file = path.join(dir, "state.json");
    await fs.writeFile(file, "not-json", "utf8");
    const repo = createJsonPositionRepo({ filePath: file, clock, logger: nullLogger });
    const r = await repo.load();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("parse_failed");
  });
});
