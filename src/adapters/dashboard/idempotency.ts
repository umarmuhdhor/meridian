// Per-write idempotency guard for the bridge /tool path.
//
// The bridge bypasses the agent once-per-session lock (see inflight.ts), so a
// write reaching /tool has no double-spend protection of its own. When a caller
// passes a `cycle_id` (the screening delegation and its OpenRouter fallback share
// ONE cycle_id), this guard gives at-most-once semantics: once a write with a key
// COMMITS successfully, any later write with the same key is rejected.
//
// Claim-on-success (not on-attempt) is deliberate: a deploy that FAILS (transient
// safety block, RPC error) must stay retryable, while a deploy that SUCCEEDED but
// whose response was lost to a network drop must NOT run again on the fallback.
//
//   delegate → Sage deploys OK → commit(cycle_id) ─┐  timeout hides the success
//   fallback (same cycle_id) → seen() = true → 409 ─┘  no double deploy
//
// Keys expire after ttlMs so memory stays bounded and stale ids never block a
// future cycle. Concurrency within one process is covered by the per-tool
// inflight lock (only one deploy_position runs at a time), so seen()→commit()
// cannot interleave for the write that matters.

export interface IdempotencyGuard {
  /** True if this key already committed and is still within its TTL window. */
  seen(key: string): boolean;
  /** Mark this key as committed. Called only after a successful write. */
  commit(key: string): void;
  /** Live key count (post-sweep). For tests / diagnostics. */
  size(): number;
}

export const createIdempotencyGuard = (
  ttlMs: number,
  now: () => number = () => Date.now(),
): IdempotencyGuard => {
  const expiry = new Map<string, number>(); // key -> expiry timestamp (ms)

  const sweep = (t: number): void => {
    for (const [k, exp] of expiry) {
      if (exp <= t) expiry.delete(k);
    }
  };

  return {
    seen(key: string): boolean {
      const t = now();
      sweep(t);
      return expiry.has(key);
    },
    commit(key: string): void {
      const t = now();
      sweep(t);
      expiry.set(key, t + ttlMs);
    },
    size(): number {
      sweep(now());
      return expiry.size;
    },
  };
};

// Default bridge instance. 10-minute TTL comfortably spans a screening interval
// (minutes) plus the delegate→timeout→fallback window.
export const bridgeIdempotency: IdempotencyGuard = createIdempotencyGuard(10 * 60 * 1000);
