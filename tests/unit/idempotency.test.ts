import { describe, it, expect } from "vitest";
import { createIdempotencyGuard } from "../../src/adapters/dashboard/idempotency.js";

describe("idempotency guard", () => {
  it("is unseen before commit, seen after", () => {
    const g = createIdempotencyGuard(1000, () => 0);
    expect(g.seen("k1")).toBe(false);
    g.commit("k1");
    expect(g.seen("k1")).toBe(true);
  });

  it("keeps distinct keys independent", () => {
    const g = createIdempotencyGuard(1000, () => 0);
    g.commit("a");
    expect(g.seen("a")).toBe(true);
    expect(g.seen("b")).toBe(false);
  });

  it("expires a key after its TTL window", () => {
    let now = 0;
    const g = createIdempotencyGuard(1000, () => now);
    g.commit("k");
    now = 999;
    expect(g.seen("k")).toBe(true); // still within TTL
    now = 1000;
    expect(g.seen("k")).toBe(false); // expiry <= now → swept
  });

  it("sweeps expired keys out of size()", () => {
    let now = 0;
    const g = createIdempotencyGuard(1000, () => now);
    g.commit("k1");
    g.commit("k2");
    expect(g.size()).toBe(2);
    now = 2000;
    expect(g.size()).toBe(0);
  });

  it("re-commit after expiry refreshes the window", () => {
    let now = 0;
    const g = createIdempotencyGuard(1000, () => now);
    g.commit("k");
    now = 1000;
    expect(g.seen("k")).toBe(false);
    g.commit("k");
    now = 1500;
    expect(g.seen("k")).toBe(true);
  });

  it("models the delegate→fallback double-deploy block", () => {
    const g = createIdempotencyGuard(600_000, () => 0);
    const cycleId = "screen-2026-07-14T08:52";
    // delegation: Sage deploys, response lost to timeout, but commit happened
    expect(g.seen(cycleId)).toBe(false);
    g.commit(cycleId);
    // fallback runs with the SAME cycle_id → rejected before executing
    expect(g.seen(cycleId)).toBe(true);
  });
});
