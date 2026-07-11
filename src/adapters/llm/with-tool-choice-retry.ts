import type { Logger } from "../../ports/logger.js";
import type { ChatRequest, ChatResponse, LLMClient } from "../../ports/llm-client.js";

export interface ToolChoiceRetryOptions {
  inner: LLMClient;
  /** Override the detector. Defaults to `defaultToolChoiceRejection`. */
  isToolChoiceRejection?: (err: unknown) => boolean;
  logger?: Logger;
}

/**
 * Default detector — matches errors where a provider (typically thinking-mode models)
 * rejects `tool_choice: "required"` and related fields.
 */
export function defaultToolChoiceRejection(err: unknown): boolean {
  const messages: string[] = [];
  if (err instanceof Error && typeof err.message === "string") messages.push(err.message);
  const bag = err as { error?: { message?: string } };
  if (typeof bag?.error?.message === "string") messages.push(bag.error.message);
  return messages.some((m) =>
    /tool_choice|tool choice|choice.*required|force.*tool|require.*tool/i.test(m),
  );
}

/**
 * Wrap `inner` — if the request forces a tool call (`tool_choice: "required"` or
 * `{name: ...}`) and the provider rejects that, retry with `tool_choice: "auto"`.
 * If retry still fails, retry once more with `tool_choice` omitted entirely.
 * Mirrors the JS `agentLoop` DeepSeek thinking-mode handling.
 */
export function withToolChoiceRetry(opts: ToolChoiceRetryOptions): LLMClient {
  const detect = opts.isToolChoiceRejection ?? defaultToolChoiceRejection;
  return {
    async chat(req: ChatRequest): Promise<ChatResponse> {
      try {
        return await opts.inner.chat(req);
      } catch (err) {
        if (!detect(err) || !req.tool_choice || req.tool_choice === "auto") throw err;
        opts.logger?.warn("llm-fallback", "tool_choice rejected; retrying with auto");
        const withAuto: ChatRequest = { ...req, tool_choice: "auto" };
        try {
          return await opts.inner.chat(withAuto);
        } catch (err2) {
          if (!detect(err2)) throw err2;
          opts.logger?.warn("llm-fallback", "tool_choice=auto also rejected; retrying with omitted");
          const { tool_choice: _drop, ...withoutChoice } = withAuto;
          return await opts.inner.chat(withoutChoice as ChatRequest);
        }
      }
    },
  };
}
