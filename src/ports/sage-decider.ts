// Port: delegate a screening decision to an external agent (Sage / Hermes).
//
// Unlike LLMClient (a raw completion that returns tool_calls for OUR executor to
// run), a SageDecider is AGENTIC: it reasons with its own memory AND executes the
// deploy itself by calling Meridian's dashboard bridge. So `decide()` returns only
// a prose summary — whether a deploy actually happened is determined by the caller
// via state reconciliation (position count) + the bridge idempotency key.
//
// `decide()` MUST throw on transport failure / timeout so the caller can fall back
// to the local LLM loop. A clean "chose not to deploy" is a normal return, NOT a
// throw — the caller must not treat a decline as a failure (never fall back on it).

export interface SageDecideInput {
  /** System prompt (same role prompt the local loop would use). */
  systemPrompt: string;
  /** The screening goal + candidate block. */
  goal: string;
  /** Long-term memory scope header (X-Hermes-Session-Key). */
  sessionKey: string;
  /** Idempotency key for the deploy this cycle may perform (shared with the fallback). */
  cycleId: string;
  /** Hard timeout; on expiry `decide()` throws a transient error. */
  timeoutMs: number;
}

export interface SageDecideResult {
  /** Sage's prose summary of what it decided/did. */
  text: string;
}

export interface SageDecider {
  decide(input: SageDecideInput): Promise<SageDecideResult>;
}
