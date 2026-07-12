import { describe, it, expect } from "vitest";
import { scryptSync, randomBytes } from "node:crypto";
import { verifyPin, RateLimiter } from "./auth-core";

function makeHash(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

describe("verifyPin", () => {
  const stored = makeHash("123456");

  it("accepts the correct PIN", () => {
    expect(verifyPin("123456", stored)).toBe(true);
  });

  it("rejects a wrong PIN", () => {
    expect(verifyPin("654321", stored)).toBe(false);
  });

  it("rejects non-6-digit input", () => {
    expect(verifyPin("12345", stored)).toBe(false);
    expect(verifyPin("1234567", stored)).toBe(false);
    expect(verifyPin("12a456", stored)).toBe(false);
    expect(verifyPin("", stored)).toBe(false);
  });

  it("rejects when no stored hash is configured", () => {
    expect(verifyPin("123456", undefined)).toBe(false);
    expect(verifyPin("123456", "")).toBe(false);
  });

  it("rejects malformed stored values", () => {
    expect(verifyPin("123456", "nosalt")).toBe(false);
    expect(verifyPin("123456", ":onlyhash")).toBe(false);
    expect(verifyPin("123456", "salt:")).toBe(false);
    expect(verifyPin("123456", "salt:zzzz")).toBe(false); // bad hex / wrong length
  });
});

describe("RateLimiter", () => {
  it("locks out after max failed attempts and unlocks after the window", () => {
    const rl = new RateLimiter(3, 1000);
    const ip = "1.2.3.4";
    const t0 = 10_000;

    expect(rl.locked(ip, t0)).toBe(false);
    rl.fail(ip, t0);
    rl.fail(ip, t0);
    expect(rl.locked(ip, t0)).toBe(false); // 2 < 3
    rl.fail(ip, t0);
    expect(rl.locked(ip, t0)).toBe(true); // 3 == max → locked

    // still locked inside the window
    expect(rl.locked(ip, t0 + 999)).toBe(true);
    // unlocked after the window
    expect(rl.locked(ip, t0 + 1001)).toBe(false);
  });

  it("reset clears the counter", () => {
    const rl = new RateLimiter(2, 1000);
    const ip = "5.6.7.8";
    rl.fail(ip, 0);
    rl.fail(ip, 0);
    expect(rl.locked(ip, 0)).toBe(true);
    rl.reset(ip);
    expect(rl.locked(ip, 0)).toBe(false);
  });

  it("keys are independent", () => {
    const rl = new RateLimiter(1, 1000);
    rl.fail("a", 0);
    expect(rl.locked("a", 0)).toBe(true);
    expect(rl.locked("b", 0)).toBe(false);
  });
});
