// Recursive secret redaction for user-config.json (PRD §8.5, reference.md §8).
// Match keys that END in a credential word so real secrets (publicApiKey,
// hiveMindApiKey, gmgnApiKey) are redacted, but substrings don't over-match —
// the old /key|token|.../ redacted minTokenFeesSol / min/maxTokenAgeHours
// (they contain "token"), hiding legit numeric thresholds behind "[redacted]".
// Keep in sync with dashboard/web/lib/files.ts.
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
