import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { err, ok, type Result } from "../../../shared/result.js";

export type LoadError =
  | { kind: "not_found"; path: string }
  | { kind: "read_failed"; path: string; message: string }
  | { kind: "parse_failed"; path: string; message: string }
  | { kind: "validation_failed"; path: string; issues: z.ZodIssue[] };

/**
 * Atomic JSON write — write to sibling temp file, fsync, rename over target.
 * `rename` is atomic on POSIX for same-filesystem paths, so a crash never leaves
 * a half-written file at the destination.
 */
export async function writeJsonAtomic(
  filePath: string,
  data: unknown,
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
  await fs.rename(tmp, filePath);
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
