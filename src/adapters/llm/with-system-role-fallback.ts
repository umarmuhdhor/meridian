import type { Logger } from "../../ports/logger.js";
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  LLMClient,
} from "../../ports/llm-client.js";

export interface SystemRoleFallbackOptions {
  inner: LLMClient;
  /** Override the detector. Defaults to `defaultSystemRoleRejection`. */
  isSystemRoleRejection?: (err: unknown) => boolean;
  logger?: Logger;
}

/**
 * Default detector — matches OpenRouter / provider errors that reject the `system` role
 * (typically thinking-mode models). Tolerates both `err.message` string form and
 * OpenAI SDK's `err.error.message` shape.
 */
export function defaultSystemRoleRejection(err: unknown): boolean {
  const messages: string[] = [];
  if (err instanceof Error && typeof err.message === "string") messages.push(err.message);
  const bag = err as { error?: { message?: string } };
  if (typeof bag?.error?.message === "string") messages.push(bag.error.message);
  return messages.some((m) => /system.*role|role.*system|does not support.*system/i.test(m));
}

/**
 * Wrap `inner` — if a request with a leading `system` message fails with a
 * "system role not supported" style error, retry with that content embedded
 * into the first user message. Mirrors the `providerMode = "user_embedded"`
 * fallback in the JS `agentLoop`.
 */
export function withSystemRoleFallback(opts: SystemRoleFallbackOptions): LLMClient {
  const detect = opts.isSystemRoleRejection ?? defaultSystemRoleRejection;
  return {
    async chat(req: ChatRequest): Promise<ChatResponse> {
      try {
        return await opts.inner.chat(req);
      } catch (err) {
        if (!detect(err)) throw err;
        const rewritten = embedSystemIntoUser(req);
        if (rewritten === req) throw err; // no system message present — nothing to retry
        opts.logger?.warn("llm-fallback", "system role rejected; retrying with user-embedded prompt");
        return opts.inner.chat(rewritten);
      }
    },
  };
}

function embedSystemIntoUser(req: ChatRequest): ChatRequest {
  const idx = req.messages.findIndex((m) => m.role === "system");
  if (idx === -1) return req;
  const system = req.messages[idx]!;
  const rest = req.messages.filter((_, i) => i !== idx);
  const firstUserIdx = rest.findIndex((m) => m.role === "user");
  const embedded: ChatMessage = {
    role: "user",
    content: `[SYSTEM]\n${system.content}\n[/SYSTEM]\n\n${
      firstUserIdx >= 0 ? rest[firstUserIdx]!.content : ""
    }`.trim(),
  };
  let nextMessages: ChatMessage[];
  if (firstUserIdx >= 0) {
    nextMessages = rest.map((m, i) => (i === firstUserIdx ? embedded : m));
  } else {
    nextMessages = [embedded, ...rest];
  }
  return { ...req, messages: nextMessages };
}
