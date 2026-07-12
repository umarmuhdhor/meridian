// Pure, testable auth primitives for the dashboard PIN gate.
//
//   PIN (6 digits) ──scrypt(salt)──► derived key ──timingSafeEqual──► stored hash
//                                                     │
//                                          constant-time, no timing oracle
//
// The stored value is "<saltHex>:<hashHex>" (see the hash-gen command in the
// deploy guide). node:crypto only — no native deps, runs on the small VPS.

import { scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_KEYLEN = 64;

/**
 * Verify a 6-digit PIN against the stored "salt:hash" value.
 * Returns false for any malformed input or mismatch. Constant-time on the
 * hash compare; rejects non-6-digit PINs before hashing.
 */
export function verifyPin(pin: string, storedHash: string | undefined): boolean {
  if (!storedHash) return false;
  if (!/^\d{6}$/.test(pin)) return false;
  const idx = storedHash.indexOf(":");
  if (idx <= 0) return false;
  const salt = storedHash.slice(0, idx);
  const hashHex = storedHash.slice(idx + 1);
  if (!salt || !hashHex) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const derived = scryptSync(pin, salt, SCRYPT_KEYLEN);
  return timingSafeEqual(derived, expected);
}

export interface RateState {
  count: number;
  /** epoch ms until which the ip is locked; 0 = not locked. */
  until: number;
}

/**
 * Per-key attempt limiter with lockout. Defense-in-depth behind Cloudflare
 * Access (which is the primary brute-force gate). In-memory — single Next
 * instance; resets on restart, which is acceptable because the counter only
 * ever slows an attacker who has already passed the edge identity gate.
 */
export class RateLimiter {
  private readonly map = new Map<string, RateState>();

  constructor(
    private readonly max = 5,
    private readonly lockMs = 15 * 60 * 1000,
  ) {}

  /** True if the key is currently locked out. */
  locked(key: string, now: number): boolean {
    const r = this.map.get(key);
    return !!(r && r.until > now);
  }

  /** Record a failed attempt; sets a lockout once max is reached. */
  fail(key: string, now: number): void {
    const r = this.map.get(key);
    // Reset the counter only when a REAL lockout (until > 0) has expired —
    // not for the until:0 "counting but not locked" state.
    const lockoutExpired = r != null && r.until > 0 && r.until <= now;
    const base = r == null || lockoutExpired ? 0 : r.count;
    const count = base + 1;
    this.map.set(key, count >= this.max ? { count, until: now + this.lockMs } : { count, until: 0 });
  }

  /** Clear state on success. */
  reset(key: string): void {
    this.map.delete(key);
  }
}
