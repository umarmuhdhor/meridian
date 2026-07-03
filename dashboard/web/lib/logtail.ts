import "server-only";
import { open, stat, readdir } from "node:fs/promises";
import path from "node:path";

// Server-side tail of logs/actions-YYYY-MM-DD.jsonl. Reads only a bounded chunk
// from the END of the file (MUST NOT full-load, #10). Filters tool/success/minDuration.

function meridianRoot(): string {
  return process.env.MERIDIAN_ROOT || path.resolve(process.cwd(), "../..");
}

const TAIL_BYTES = 256 * 1024; // read at most 256KB from the tail regardless of file size

async function latestActionsFile(logsDir: string, date?: string): Promise<string | null> {
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return path.join(logsDir, `actions-${date}.jsonl`);
  try {
    const files = (await readdir(logsDir))
      .filter((f) => /^actions-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .sort();
    return files.length ? path.join(logsDir, files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

async function tailLines(file: string, maxLines: number): Promise<string[]> {
  const { size } = await stat(file);
  if (size === 0) return [];
  const chunk = Math.min(size, TAIL_BYTES);
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(chunk);
    await fh.read(buf, 0, chunk, Math.max(0, size - chunk));
    // Drop a possibly-partial first line when we didn't start at byte 0.
    const lines = buf.toString("utf8").split("\n").filter(Boolean);
    if (size > chunk && lines.length) lines.shift();
    return lines.slice(-maxLines);
  } finally {
    await fh.close();
  }
}

export interface ActionLogEntry {
  timestamp?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
  duration_ms?: number;
  success?: boolean;
}

export interface LogFilter {
  date?: string;
  tool?: string;
  success?: "ok" | "fail";
  minDuration?: number;
  limit?: number;
}

export interface LogResult {
  file: string | null;
  entries: ActionLogEntry[];
  tools: string[];
}

export async function tailActionLog(f: LogFilter): Promise<LogResult> {
  const logsDir = path.join(meridianRoot(), "logs");
  const file = await latestActionsFile(logsDir, f.date);
  if (!file) return { file: null, entries: [], tools: [] };

  const limit = Number.isFinite(f.limit) && f.limit ? Math.min(f.limit, 1000) : 200;
  let raw: string[];
  try {
    raw = await tailLines(file, limit * 5); // over-read, then filter down to `limit`
  } catch {
    return { file: path.basename(file), entries: [], tools: [] };
  }

  const parsed: ActionLogEntry[] = [];
  for (const line of raw) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      /* skip corrupt line */
    }
  }

  const tools = Array.from(new Set(parsed.map((e) => e.tool).filter(Boolean))).sort() as string[];

  let entries = parsed;
  if (f.tool) entries = entries.filter((e) => e.tool === f.tool);
  if (f.success === "ok") entries = entries.filter((e) => e.success === true);
  if (f.success === "fail") entries = entries.filter((e) => e.success === false);
  if (f.minDuration != null && Number.isFinite(f.minDuration))
    entries = entries.filter((e) => (e.duration_ms ?? 0) >= f.minDuration!);

  entries = entries.slice(-limit).reverse(); // newest first
  return { file: path.basename(file), entries, tools };
}
