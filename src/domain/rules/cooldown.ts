import type { PoolMemoryDb, PoolMemoryEntry } from "../schemas/pool-memory.js";

/**
 * Pure — pool cooldown check. Returns true when the pool's cooldown_until is a future ISO time
 * relative to `now`.
 */
export function isPoolOnCooldown(
  entry: Pick<PoolMemoryEntry, "cooldown_until"> | null | undefined,
  now: Date,
): boolean {
  const until = entry?.cooldown_until;
  if (!until) return false;
  return new Date(until).getTime() > now.getTime();
}

/**
 * Pure — base-mint cooldown check across the entire pool-memory DB. Returns true when ANY entry
 * for that base_mint has a base_mint_cooldown_until in the future.
 */
export function isBaseMintOnCooldown(
  db: PoolMemoryDb,
  baseMint: string | null | undefined,
  now: Date,
): boolean {
  if (!baseMint) return false;
  const nowMs = now.getTime();
  for (const entry of Object.values(db)) {
    if (
      entry?.base_mint === baseMint &&
      entry?.base_mint_cooldown_until &&
      new Date(entry.base_mint_cooldown_until).getTime() > nowMs
    ) {
      return true;
    }
  }
  return false;
}
