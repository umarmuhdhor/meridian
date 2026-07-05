import type { OpenAiToolSchema } from "../app/tools/generate-openai-schemas.js";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** For assistant messages that invoked tools. */
  tool_calls?: ToolCallRequest[];
  /** For tool-role messages — the id of the tool_call being answered. */
  tool_call_id?: string;
  /** Optional name — used by tool-role messages. */
  name?: string;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  /** Raw JSON string as returned by the LLM. Parsed + validated by the executor. */
  arguments: string;
}

export type ToolChoice = "auto" | "required" | "none" | { name: string };

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: OpenAiToolSchema[];
  tool_choice?: ToolChoice;
  temperature?: number;
  max_tokens?: number;
}

export interface ChatResponse {
  text: string | null;
  tool_calls: ToolCallRequest[];
  /** Provider-reported finish reason ("stop" / "tool_calls" / "length" / …). */
  finish_reason: string | null;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
}

/**
 * Provider-agnostic LLM chat. Providers (OpenRouter / OpenAI / LM Studio / etc.) implement
 * this behind an OpenAI-compatible HTTP contract. Retries / provider fallback live in the
 * agent loop, NOT in the client — so this is a single call, no orchestration.
 */
export interface LLMClient {
  chat(req: ChatRequest): Promise<ChatResponse>;
}
