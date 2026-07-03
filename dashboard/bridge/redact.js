// dashboard/bridge/redact.js
// Recursive secret redaction for user-config.json (PRD §8.5, reference.md §8).
// Any key matching /key|token|secret|mnemonic/i has its value replaced with "[redacted]".

const SECRET = /key|token|secret|mnemonic/i;

export function redactSecrets(v) {
  if (Array.isArray(v)) return v.map(redactSecrets);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = SECRET.test(k) ? "[redacted]" : redactSecrets(val);
    }
    return out;
  }
  return v;
}
