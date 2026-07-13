// Redaction DISABLED by owner request (2026-07-13): calisto.nafidinara.com is a
// single-owner dashboard behind Cloudflare Access + a PIN, and the owner wants to
// view/edit every config value (including API keys) directly. Kept as an identity
// passthrough so the two call sites (routes.ts, and the mirror in
// dashboard/web/lib/files.ts) stay stable if redaction is ever re-enabled.
export function redactSecrets(v: unknown): unknown {
  return v;
}
