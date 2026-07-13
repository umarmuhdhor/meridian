import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Read-only access to the daemon's root JSON state files via fs.
// Whitelist + redaction MUST mirror the bridge exactly (reference.md §3/§8).

// :name → file at repo root.
export const FILE_WHITELIST: Record<string, string> = {
  "lessons": "lessons.json",
  "decision-log": "decision-log.json",
  "pool-memory": "pool-memory.json",
  "signal-weights": "signal-weights.json",
  "strategy-library": "strategy-library.json",
  "smart-wallets": "smart-wallets.json",
  "token-blacklist": "token-blacklist.json",
  "dev-blocklist": "dev-blocklist.json",
  "state": "state.json",
  "user-config": "user-config.json",
};

// Match keys ENDING in a credential word (publicApiKey, hiveMindApiKey, ...) so
// substrings don't over-match — a bare /token/ redacted minTokenFeesSol and
// min/maxTokenAgeHours. Keep in sync with src/adapters/dashboard/redact.ts.
const SECRET = /(key|secret|mnemonic|password|token)$/i;

export function redactSecrets(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redactSecrets);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SECRET.test(k) ? "[redacted]" : redactSecrets(val);
    }
    return out;
  }
  return v;
}

// dashboard/web → ../.. = repo root, unless MERIDIAN_ROOT overrides.
function meridianRoot(): string {
  return process.env.MERIDIAN_ROOT || path.resolve(process.cwd(), "../..");
}

export function isWhitelistedFile(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(FILE_WHITELIST, name);
}

// Returns parsed JSON (redacted for user-config), or null if the file is missing.
// Throws only on a non-whitelisted name (caller maps to 400).
export async function readRootJson(name: string): Promise<unknown> {
  const file = FILE_WHITELIST[name];
  if (!file) throw new Error("invalid file name");
  try {
    const raw = await readFile(path.join(meridianRoot(), file), "utf8");
    const data = JSON.parse(raw);
    return name === "user-config" ? redactSecrets(data) : data;
  } catch {
    return null; // missing/unreadable file → treat as empty
  }
}
