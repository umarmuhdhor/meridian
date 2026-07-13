import { describe, it, expect } from "vitest";
import { redactSecrets } from "../../src/adapters/dashboard/redact.js";

// Redaction is intentionally DISABLED (owner-only PIN-gated dashboard wants every
// value visible). redactSecrets is an identity passthrough; these tests lock that
// contract so a future re-enable is a deliberate, test-breaking change.
describe("redactSecrets (disabled — identity passthrough)", () => {
  it("returns credential keys unchanged", () => {
    const out = redactSecrets({ publicApiKey: "abc", hiveMindApiKey: "def", gmgnApiKey: "ghi" });
    expect(out).toEqual({ publicApiKey: "abc", hiveMindApiKey: "def", gmgnApiKey: "ghi" });
  });

  it("returns numeric thresholds unchanged", () => {
    const out = redactSecrets({ minTokenFeesSol: 50, minTokenAgeHours: 24 });
    expect(out).toEqual({ minTokenFeesSol: 50, minTokenAgeHours: 24 });
  });

  it("returns nested structures unchanged", () => {
    const input = { nested: { apiKey: "x", limit: 5 }, list: [{ secret: "s" }] };
    expect(redactSecrets(input)).toEqual(input);
  });
});
