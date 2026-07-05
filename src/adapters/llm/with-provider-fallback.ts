import type { Logger } from "../../ports/logger.js";
import type { ChatRequest, ChatResponse, LLMClient } from "../../ports/llm-client.js";

export interface ProviderFallbackOptions {
  primary: LLMClient;
  /** Fallbacks tried in order after the primary raises a transient error. */
  fallbacks: LLMClient[];
  /**
   * Override the transient-error detector. Defaults to `defaultIsTransient` —
   * matches 502 / 503 / 504 / 529 / ETIMEDOUT / ECONNRESET / abort.
   */
  isTransient?: (err: unknown) => boolean;
  logger?: Logger;
}

const TRANSIENT_STATUS = new Set([502, 503, 504, 529]);
const TRANSIENT_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EAI_AGAIN",
  "ABORT_ERR",
]);

/** Default transient-error predicate — HTTP 5xx we've seen from OpenRouter + node-fetch codes. */
export function defaultIsTransient(err: unknown): boolean {
  if (err == null) return false;
  const e = err as { status?: number; code?: string; name?: string; message?: string };
  if (typeof e.status === "number" && TRANSIENT_STATUS.has(e.status)) return true;
  if (typeof e.code === "string" && TRANSIENT_CODES.has(e.code)) return true;
  if (typeof e.name === "string" && /abort/i.test(e.name)) return true;
  if (typeof e.message === "string" && /timeout|temporar|overload/i.test(e.message)) return true;
  return false;
}

/**
 * Wrap `primary` so transient failures cascade through `fallbacks` in order.
 * The last failure (from the final fallback) is rethrown. Non-transient errors
 * fail fast — they wouldn't succeed on a different provider either.
 */
export function withProviderFallback(opts: ProviderFallbackOptions): LLMClient {
  const isTransient = opts.isTransient ?? defaultIsTransient;
  const chain: LLMClient[] = [opts.primary, ...opts.fallbacks];

  return {
    async chat(req: ChatRequest): Promise<ChatResponse> {
      let lastErr: unknown;
      for (let i = 0; i < chain.length; i += 1) {
        const client = chain[i]!;
        try {
          return await client.chat(req);
        } catch (err) {
          lastErr = err;
          if (i === chain.length - 1 || !isTransient(err)) {
            throw err;
          }
          opts.logger?.warn(
            "llm-fallback",
            `provider ${i}/${chain.length - 1} failed, falling to next`,
            { error: err instanceof Error ? err.message : String(err) },
          );
        }
      }
      // Unreachable — the loop above always throws or returns.
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    },
  };
}
