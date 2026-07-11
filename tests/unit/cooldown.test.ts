import { describe, it, expect } from "vitest";
import { isPoolOnCooldown, isBaseMintOnCooldown } from "../../src/domain/rules/cooldown.js";
import type { PoolMemoryDb } from "../../src/domain/schemas/pool-memory.js";

const NOW = new Date("2026-07-05T12:00:00.000Z");
const FUTURE = "2026-07-05T18:00:00.000Z";
const PAST = "2026-07-05T06:00:00.000Z";

const entry = (over: Record<string, unknown> = {}): PoolMemoryDb[string] => ({
  name: "TKN/SOL",
  base_mint: "MINT_A",
  deploys: [],
  total_deploys: 0,
  avg_pnl_pct: 0,
  win_rate: 0,
  adjusted_win_rate: 0,
  adjusted_win_rate_sample_count: 0,
  last_deployed_at: null,
  last_outcome: null,
  notes: [],
  snapshots: [],
  ...over,
});

describe("isPoolOnCooldown", () => {
  it("false when entry is null/undefined", () => {
    expect(isPoolOnCooldown(null, NOW)).toBe(false);
    expect(isPoolOnCooldown(undefined, NOW)).toBe(false);
  });

  it("false when no cooldown_until", () => {
    expect(isPoolOnCooldown(entry(), NOW)).toBe(false);
  });

  it("true when cooldown_until in future", () => {
    expect(isPoolOnCooldown(entry({ cooldown_until: FUTURE }), NOW)).toBe(true);
  });

  it("false when cooldown_until in past", () => {
    expect(isPoolOnCooldown(entry({ cooldown_until: PAST }), NOW)).toBe(false);
  });
});

describe("isBaseMintOnCooldown", () => {
  it("false when baseMint null/empty", () => {
    expect(isBaseMintOnCooldown({}, null, NOW)).toBe(false);
    expect(isBaseMintOnCooldown({}, "", NOW)).toBe(false);
  });

  it("true when ANY entry for that mint has future base_mint_cooldown_until", () => {
    const db: PoolMemoryDb = {
      poolA: entry({ base_mint: "OTHER" }),
      poolB: entry({ base_mint: "MINT_A", base_mint_cooldown_until: FUTURE }),
      poolC: entry({ base_mint: "MINT_A" }),
    };
    expect(isBaseMintOnCooldown(db, "MINT_A", NOW)).toBe(true);
  });

  it("false when only past cooldowns for that mint", () => {
    const db: PoolMemoryDb = {
      poolA: entry({ base_mint: "MINT_A", base_mint_cooldown_until: PAST }),
    };
    expect(isBaseMintOnCooldown(db, "MINT_A", NOW)).toBe(false);
  });

  it("false when the mint doesn't exist in DB", () => {
    const db: PoolMemoryDb = {
      poolA: entry({ base_mint: "OTHER", base_mint_cooldown_until: FUTURE }),
    };
    expect(isBaseMintOnCooldown(db, "MINT_A", NOW)).toBe(false);
  });
});
