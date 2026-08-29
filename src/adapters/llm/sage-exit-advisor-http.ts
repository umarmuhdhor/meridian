// HTTP implementation of the SageExitAdvisor port. Same Hermes OpenAI-compatible
// endpoint + transport pattern as sage-decider-http, but ADVISORY: it sends one
// position's signals and parses a `CLOSE: …` / `HOLD: …` verdict back. No tools,
// no server-side writes. Unusable/malformed responses throw SageTransportError so
// the caller applies its conditional deterministic fallback.

import type {
  SageExitAdvisor,
  SageExitAdviseInput,
  SageExitVerdict,
} from "../../ports/sage-exit-advisor.js";
import { SageTransportError, type FetchLike } from "./sage-decider-http.js";

export interface SageExitAdvisorHttpOptions {
  baseUrl: string;
  apiKey: string;
  model?: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
  fetchImpl?: FetchLike;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

/** Parse "CLOSE: reason" / "HOLD: reason" (case-insensitive, anywhere in the first line). */
export function parseExitVerdict(text: string): SageExitVerdict | null {
  const trimmed = text.trim();
  const m = /\b(CLOSE|HOLD)\b\s*[:\-]?\s*(.*)/is.exec(trimmed);
  if (!m) return null;
  const action = m[1]!.toUpperCase() === "CLOSE" ? "CLOSE" : "HOLD";
  const reason = (m[2] ?? "").trim().slice(0, 400) || `${action} (no reason given)`;
  return { action, reason };
}

export function createSageExitAdvisorHttp(opts: SageExitAdvisorHttpOptions): SageExitAdvisor {
  const model = opts.model ?? "hermes-agent";
  const base = opts.baseUrl.replace(/\/+$/, "");
  const doFetch: FetchLike = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  return {
    async advise(input: SageExitAdviseInput): Promise<SageExitVerdict> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "meridian-daemon/1.0",
        Authorization: `Bearer ${opts.apiKey}`,
        "X-Hermes-Session-Key": input.sessionKey,
      };
      if (opts.cfAccessClientId && opts.cfAccessClientSecret) {
        headers["CF-Access-Client-Id"] = opts.cfAccessClientId;
        headers["CF-Access-Client-Secret"] = opts.cfAccessClientSecret;
      }
      try {
        const res = await doFetch(`${base}/v1/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            stream: false,
            messages: [
              { role: "system", content: input.systemPrompt },
              { role: "user", content: input.goal },
            ],
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new SageTransportError(`sage exit-advisor ${res.status}: ${detail.slice(0, 200)}`);
        }
        const body = (await res.json()) as ChatCompletionResponse;
        const text = body.choices?.[0]?.message?.content ?? "";
        const verdict = parseExitVerdict(text);
        if (!verdict) {
          throw new SageTransportError(`unparseable exit verdict: ${text.slice(0, 120)}`);
        }
        return verdict;
      } catch (err) {
        if (err instanceof SageTransportError) throw err;
        const name = (err as { name?: string }).name ?? "";
        const msg = (err as { message?: string }).message ?? String(err);
        throw new SageTransportError(/abort/i.test(name) ? `sage exit-advisor timeout after ${input.timeoutMs}ms` : msg);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
