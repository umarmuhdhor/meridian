// HTTP implementation of the SageDecider port. Talks to Hermes' OpenAI-compatible
// API server (gateway/platforms/api_server.py) at POST /v1/chat/completions.
//
// Hermes runs its OWN agent loop server-side and executes tools (our `meridian`
// plugin → dashboard bridge) itself, then returns final prose. We therefore do NOT
// send `tools` and do NOT read tool_calls back — Hermes' endpoint never emits them
// (tool_execution: "server"). Memory is scoped by the X-Hermes-Session-Key header.

import type {
  SageDecider,
  SageDecideInput,
  SageDecideResult,
} from "../../ports/sage-decider.js";

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;

export interface SageDeciderHttpOptions {
  /** Base URL of the Hermes api server, e.g. http://100.x.y.z:8642 (no trailing /v1). */
  baseUrl: string;
  /** API_SERVER_KEY for the Hermes api server. */
  apiKey: string;
  /** Model id the api server advertises (default "hermes-agent"). */
  model?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: FetchLike;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

/** Error thrown on transport failure / timeout — matches the transient predicate so the caller falls back. */
export class SageTransportError extends Error {
  readonly code = "SAGE_TRANSPORT";
  constructor(message: string) {
    super(message);
    this.name = "SageTransportError";
  }
}

export function createSageDeciderHttp(opts: SageDeciderHttpOptions): SageDecider {
  const model = opts.model ?? "hermes-agent";
  const base = opts.baseUrl.replace(/\/+$/, "");
  const doFetch: FetchLike = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  return {
    async decide(input: SageDecideInput): Promise<SageDecideResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs);
      try {
        const res = await doFetch(`${base}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${opts.apiKey}`,
            "X-Hermes-Session-Key": input.sessionKey,
          },
          body: JSON.stringify({
            model,
            stream: false,
            messages: [
              { role: "system", content: input.systemPrompt },
              {
                role: "user",
                // cycle_id is surfaced so Sage passes it to the deploy tool → bridge
                // idempotency. Reconciliation is the backstop if the model omits it.
                content: `${input.goal}\n\ncycle_id: ${input.cycleId}`,
              },
            ],
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new SageTransportError(`sage api ${res.status}: ${detail.slice(0, 200)}`);
        }
        const body = (await res.json()) as ChatCompletionResponse;
        const text = body.choices?.[0]?.message?.content ?? "";
        return { text: text.trim() };
      } catch (err) {
        if (err instanceof SageTransportError) throw err;
        const name = (err as { name?: string }).name ?? "";
        const msg = (err as { message?: string }).message ?? String(err);
        // AbortError (timeout) and network errors are transient → caller falls back.
        throw new SageTransportError(/abort/i.test(name) ? `sage timeout after ${input.timeoutMs}ms` : msg);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
