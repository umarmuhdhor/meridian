import { describe, it, expect, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readJsonValidated, writeJsonAtomic } from "../../src/adapters/persistence/json/atomic-write.js";
import { mkTmpDir, rmDir } from "./tmpdir.js";

const created: string[] = [];

afterEach(async () => {
  while (created.length) {
    const d = created.pop();
    if (d) await rmDir(d);
  }
});

describe("writeJsonAtomic", () => {
  it("writes JSON and leaves no .tmp sibling behind", async () => {
    const dir = await mkTmpDir("atomic");
    created.push(dir);
    const file = path.join(dir, "state.json");
    await writeJsonAtomic(file, { hello: "world", n: 42 });
    const raw = await fs.readFile(file, "utf8");
    expect(JSON.parse(raw)).toEqual({ hello: "world", n: 42 });
    const dirents = await fs.readdir(dir);
    expect(dirents).toEqual(["state.json"]);
  });

  it("creates missing parent directories", async () => {
    const dir = await mkTmpDir("mkdir");
    created.push(dir);
    const file = path.join(dir, "nested", "deep", "state.json");
    await writeJsonAtomic(file, { ok: true });
    const raw = await fs.readFile(file, "utf8");
    expect(JSON.parse(raw)).toEqual({ ok: true });
  });

  it("overwrites existing file", async () => {
    const dir = await mkTmpDir("overwrite");
    created.push(dir);
    const file = path.join(dir, "s.json");
    await writeJsonAtomic(file, { v: 1 });
    await writeJsonAtomic(file, { v: 2 });
    const raw = await fs.readFile(file, "utf8");
    expect(JSON.parse(raw)).toEqual({ v: 2 });
  });

  // Regression: a single-file Docker bind mount makes rename fail with EBUSY
  // (the mount pins the inode). The in-place fallback must still persist the data
  // and clean up the temp — without it the dashboard update_config throws EBUSY.
  it("falls back to in-place overwrite when rename throws EBUSY", async () => {
    const dir = await mkTmpDir("ebusy");
    created.push(dir);
    const file = path.join(dir, "user-config.json");
    await writeJsonAtomic(file, { v: 1 }); // seed the "bind-mounted" target
    const spy = vi
      .spyOn(fs, "rename")
      .mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EBUSY" }));
    try {
      await writeJsonAtomic(file, { v: 2 });
    } finally {
      spy.mockRestore();
    }
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ v: 2 });
    // Temp sibling cleaned up — only the target remains.
    expect(await fs.readdir(dir)).toEqual(["user-config.json"]);
  });
});

describe("readJsonValidated", () => {
  const Schema = z.object({ count: z.number().int().nonnegative() });

  it("returns not_found for missing file", async () => {
    const dir = await mkTmpDir("read-nf");
    created.push(dir);
    const r = await readJsonValidated(path.join(dir, "nope.json"), Schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("returns parse_failed for corrupt JSON", async () => {
    const dir = await mkTmpDir("read-parse");
    created.push(dir);
    const file = path.join(dir, "bad.json");
    await fs.writeFile(file, "{not valid json", "utf8");
    const r = await readJsonValidated(file, Schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("parse_failed");
  });

  it("returns validation_failed with issue list for schema mismatch", async () => {
    const dir = await mkTmpDir("read-val");
    created.push(dir);
    const file = path.join(dir, "wrong.json");
    await fs.writeFile(file, JSON.stringify({ count: -3 }), "utf8");
    const r = await readJsonValidated(file, Schema);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "validation_failed") {
      expect(r.error.issues.length).toBeGreaterThan(0);
    } else {
      throw new Error("expected validation_failed");
    }
  });

  it("round-trips through writeJsonAtomic", async () => {
    const dir = await mkTmpDir("roundtrip");
    created.push(dir);
    const file = path.join(dir, "s.json");
    await writeJsonAtomic(file, { count: 7 });
    const r = await readJsonValidated(file, Schema);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ count: 7 });
  });
});
