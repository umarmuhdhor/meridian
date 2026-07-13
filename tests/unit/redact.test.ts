import { describe, it, expect } from "vitest";
import { redactSecrets } from "../../src/adapters/dashboard/redact.js";

describe("redactSecrets", () => {
  it("redacts real credential keys (end in Key)", () => {
    const out = redactSecrets({
      publicApiKey: "abc",
      hiveMindApiKey: "def",
      gmgnApiKey: "ghi",
    }) as Record<string, unknown>;
    expect(out.publicApiKey).toBe("[redacted]");
    expect(out.hiveMindApiKey).toBe("[redacted]");
    expect(out.gmgnApiKey).toBe("[redacted]");
  });

  it("does NOT redact numeric threshold keys that merely contain 'token'", () => {
    // Regression: the old /token/ substring match hid these behind "[redacted]".
    const out = redactSecrets({
      minTokenFeesSol: 50,
      minTokenAgeHours: 24,
      maxTokenAgeHours: 168,
    }) as Record<string, unknown>;
    expect(out.minTokenFeesSol).toBe(50);
    expect(out.minTokenAgeHours).toBe(24);
    expect(out.maxTokenAgeHours).toBe(168);
  });

  it("recurses into nested objects and arrays", () => {
    const out = redactSecrets({ nested: { apiKey: "x", limit: 5 }, list: [{ secret: "s" }] }) as {
      nested: Record<string, unknown>;
      list: Array<Record<string, unknown>>;
    };
    expect(out.nested.apiKey).toBe("[redacted]");
    expect(out.nested.limit).toBe(5);
    expect(out.list[0]!.secret).toBe("[redacted]");
  });
});
