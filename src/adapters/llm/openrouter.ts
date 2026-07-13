import OpenAI from "openai";
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  LLMClient,
  ToolCallRequest,
  ToolChoice,
} from "../../ports/llm-client.js";

export interface OpenRouterOptions {
  apiKey: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Thin wrapper over the openai npm package. Any OpenAI-compatible endpoint (OpenRouter,
 * LM Studio, a self-hosted model) works — override `baseURL`. Provider fallback + retries
 * live in the agent loop, so this is a single-call adapter.
 */
export function createOpenRouterLLMClient(opts: OpenRouterOptions): LLMClient {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL ?? DEFAULT_BASE_URL,
    ...(opts.defaultHeaders ? { defaultHeaders: opts.defaultHeaders } : {}),
  });

  return {
    async chat(req: ChatRequest): Promise<ChatResponse> {
      const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
        model: req.model,
        messages: req.messages.map(toOpenAiMessage),
      };
      if (req.tools?.length) body.tools = req.tools;
      if (req.tool_choice) body.tool_choice = toOpenAiToolChoice(req.tool_choice);
      if (req.temperature !== undefined) body.temperature = req.temperature;
      if (req.max_tokens !== undefined) body.max_tokens = req.max_tokens;
      const response = await client.chat.completions.create(body);

      // OpenRouter can return HTTP 200 with an error object (rate limit, provider
      // down, context too long, moderation) and NO `choices` field. Reading
      // response.choices[0] then throws a cryptic "Cannot read properties of
      // undefined (reading '0')" that aborts the whole cycle. Guard + surface the
      // real provider error so the next cycle's log is actionable.
      const first = response.choices?.[0];
      if (!first) {
        const errObj = (response as { error?: { message?: string; code?: string | number } }).error;
        const detail = errObj?.message
          ? `provider error${errObj.code != null ? ` (${errObj.code})` : ""}: ${errObj.message}`
          : JSON.stringify(response).slice(0, 300);
        throw new Error(`LLM returned no choices — ${detail}`);
      }
      const msg = first.message;
      const toolCalls: ToolCallRequest[] = (msg.tool_calls ?? []).flatMap((tc) => {
        if (tc.type !== "function") return [];
        return [
          {
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments ?? "",
          },
        ];
      });
      return {
        text: msg.content ?? null,
        tool_calls: toolCalls,
        finish_reason: first.finish_reason ?? null,
        model: response.model,
        ...(response.usage
          ? {
              usage: {
                prompt_tokens: response.usage.prompt_tokens,
                completion_tokens: response.usage.completion_tokens,
                total_tokens: response.usage.total_tokens,
              },
            }
          : {}),
      };
    },
  };
}

type OpenAiMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function toOpenAiMessage(m: ChatMessage): OpenAiMessage {
  switch (m.role) {
    case "system":
      return { role: "system", content: m.content };
    case "user":
      return { role: "user", content: m.content };
    case "tool":
      return {
        role: "tool",
        content: m.content,
        tool_call_id: m.tool_call_id ?? "",
      };
    case "assistant": {
      const base: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        content: m.content,
      };
      if (m.tool_calls?.length) {
        base.tool_calls = m.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      return base;
    }
  }
}

function toOpenAiToolChoice(c: ToolChoice): OpenAI.Chat.Completions.ChatCompletionToolChoiceOption {
  if (c === "auto" || c === "required" || c === "none") return c;
  return { type: "function", function: { name: c.name } };
}
