import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { err, ok, type Result } from "../../../shared/result.js";

export type LoadError =
  | { kind: "not_found"; path: string }
  | { kind: "read_failed"; path: string; message: string }
  | { kind: "parse_failed"; path: string; message: string }
  | { kind: "validation_failed"; path: string; issues: z.ZodIssue[] };

export interface WriteJsonOptions {
  /**
   * Preserve the target's inode by overwriting IN PLACE instead of temp+rename.
   * REQUIRED for a **single-file Docker bind mount** (e.g. `user-config.json`).
   *
   * Why: `rename(tmp, target)` over a single-file bind mount does NOT reliably
   * fail with EBUSY — on overlayfs it SUCCEEDS by creating a NEW inode in the
   * container's upper layer, silently detaching the path from the host file. The
   * daemon's in-memory reload then works, but the durable host file is never
   * updated, so every restart reverts the change (and any other container reading
   * the same host mount, e.g. `meridian-web`, sees the stale value). Overwriting
   * the existing inode (open O_TRUNC via copyFile) keeps the bind mount intact.
   * Slightly less crash-safe than rename; fine for the small, infrequent config
   * write with a single writer. Directory-mounted state files keep temp+rename.
   */
  inPlace?: boolean;
}

/**
 * Atomic JSON write — write to sibling temp file, fsync, rename over target.
 * `rename` is atomic on POSIX for same-filesystem paths, so a crash never leaves
 * a half-written file at the destination.
 *
 * With `{ inPlace: true }` the target inode is overwritten directly (temp is
 * written+fsynced first, then copied over the existing inode) — see WriteJsonOptions.
 *
 * The legacy EBUSY/EXDEV fallback also overwrites in place, for the case where
 * rename DOES throw (some kernels/mount setups).
 */
export async function writeJsonAtomic(
  filePath: string,
  data: unknown,
  opts: WriteJsonOptions = {},
): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  const fh = await fs.open(tmp, "w");
  try {
    await fh.writeFile(payload, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }

  const overwriteInPlace = async (): Promise<void> => {
    // copyFile truncates the destination and writes into the SAME inode, so a
    // single-file bind mount stays connected to its host file.
    await fs.copyFile(tmp, filePath);
    await fs.rm(tmp, { force: true });
  };

  if (opts.inPlace) {
    // If the target does not exist yet (first write), a plain rename is correct
    // and creates it; only overwrite-in-place once it exists (and is possibly mounted).
    try {
      await fs.access(filePath);
    } catch {
      await fs.rename(tmp, filePath).catch(async () => {
        await overwriteInPlace();
      });
      return;
    }
    await overwriteInPlace();
    return;
  }

  try {
    await fs.rename(tmp, filePath);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "EBUSY" && code !== "EXDEV") throw e;
    await overwriteInPlace();
  }
}

/**
 * Load + validate a JSON file via a Zod schema. Missing file returns `not_found`;
 * corrupt JSON returns `parse_failed`; schema mismatch returns `validation_failed`
 * with the raw issue list. Never returns a partial/mystery object.
 */
export async function readJsonValidated<S extends z.ZodTypeAny>(
  filePath: string,
  schema: S,
): Promise<Result<z.output<S>, LoadError>> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return err({ kind: "not_found", path: filePath });
    return err({ kind: "read_failed", path: filePath, message: (e as Error).message });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return err({ kind: "parse_failed", path: filePath, message: (e as Error).message });
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return err({ kind: "validation_failed", path: filePath, issues: result.error.issues });
  }
  return ok(result.data);
}

export function formatLoadError(e: LoadError): string {
  switch (e.kind) {
    case "not_found":
      return `File not found: ${e.path}`;
    case "read_failed":
      return `Failed to read ${e.path}: ${e.message}`;
    case "parse_failed":
      return `Invalid JSON in ${e.path}: ${e.message}`;
    case "validation_failed": {
      const first = e.issues[0];
      const summary = first ? `${first.path.join(".")}: ${first.message}` : "unknown issue";
      return `Schema mismatch in ${e.path}: ${summary} (${e.issues.length} issue${e.issues.length === 1 ? "" : "s"})`;
    }
  }
}
