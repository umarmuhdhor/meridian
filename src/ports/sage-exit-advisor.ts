// Port: ask Sage (Hermes) for a hold-or-cut verdict on ONE ambiguous position.
//
// Unlike SageDecider (agentic — Sage executes the deploy itself), the exit advisor
// is ADVISORY: it returns a verdict and the deterministic management layer executes
// the close. Sage performs NO on-chain writes here.
//
// `advise()` MUST throw on transport failure / timeout / unusable response so the
// caller can apply its conditional deterministic fallback (in-range → HOLD, else CLOSE).

export interface SageExitAdviseInput {
  /** System prompt describing the advisor's job + output contract. */
  systemPrompt: string;
  /** The single-position signal block. */
  goal: string;
  /** Long-term memory scope header (X-Hermes-Session-Key). */
  sessionKey: string;
  /** Hard timeout; on expiry `advise()` throws a transient error. */
  timeoutMs: number;
}

export interface SageExitVerdict {
  action: "CLOSE" | "HOLD";
  reason: string;
}

export interface SageExitAdvisor {
  advise(input: SageExitAdviseInput): Promise<SageExitVerdict>;
}
