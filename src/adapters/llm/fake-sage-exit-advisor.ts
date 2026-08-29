// Test double for SageExitAdvisor. Either returns a fixed verdict or throws to
// simulate a Sage outage (so the caller's conditional fallback can be tested).

import type { SageExitAdvisor, SageExitVerdict } from "../../ports/sage-exit-advisor.js";
import { SageTransportError } from "./sage-decider-http.js";

export interface FakeSageExitAdvisor extends SageExitAdvisor {
  /** Positions passed to advise(), in call order — for assertions. */
  calls: string[];
}

export function createFakeSageExitAdvisor(
  behavior: { verdict?: SageExitVerdict; throwError?: boolean } = {},
): FakeSageExitAdvisor {
  const calls: string[] = [];
  return {
    calls,
    async advise(input) {
      calls.push(input.goal);
      if (behavior.throwError) throw new SageTransportError("fake sage exit-advisor down");
      return behavior.verdict ?? { action: "HOLD", reason: "fake: hold" };
    },
  };
}
