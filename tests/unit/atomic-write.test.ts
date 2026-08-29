import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeJsonAtomic, readJsonValidated } from "../../src/adapters/persistence/json/atomic-write.js";
import { z } from "zod";

const tmpFiles: string[] = [];
async function tmpPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "meridian-aw-"));
  const p = path.join(dir, "user-config.json");
  tmpFiles.push(dir);
  return p;
}
afterEach(async () => {
  for (const d of tmpFiles.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

describe("writeJsonAtomic", () => {
  it("inPlace: preserves the file inode across writes (bind-mount safe)", async () => {
    const p = await tmpPath();
    await writeJsonAtomic(p, { a: 1 }, { inPlace: true });
    const ino1 = (await fs.stat(p)).ino;
    await writeJsonAtomic(p, { a: 2 }, { inPlace: true });
    const ino2 = (await fs.stat(p)).ino;
    expect(ino2).toBe(ino1); // same inode → a single-file bind mount stays connected
    const loaded = await readJsonValidated(p, z.object({ a: z.number() }));
    expect(loaded.ok && loaded.value.a).toBe(2);
  });

  it("default (rename) changes the inode — the mode that detaches a bind mount", async () => {
    const p = await tmpPath();
    await writeJsonAtomic(p, { a: 1 });
    const ino1 = (await fs.stat(p)).ino;
    await writeJsonAtomic(p, { a: 2 });
    const ino2 = (await fs.stat(p)).ino;
    expect(ino2).not.toBe(ino1); // rename creates a new inode (fine for dir mounts, breaks single-file mounts)
  });

  it("inPlace: creates the file when it does not exist yet", async () => {
    const p = await tmpPath();
    await writeJsonAtomic(p, { fresh: true }, { inPlace: true });
    const loaded = await readJsonValidated(p, z.object({ fresh: z.boolean() }));
    expect(loaded.ok && loaded.value.fresh).toBe(true);
  });
});
