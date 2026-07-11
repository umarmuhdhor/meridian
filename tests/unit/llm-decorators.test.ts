import { describe, it, expect, vi } from "vitest";
import type {
  ChatRequest,
  ChatResponse,
  LLMClient,
} from "../../src/ports/llm-client.js";
import { nullLogger } from "../../src/ports/logger.js";
import {
  defaultIsTransient,
  withProviderFallback,
} from "../../src/adapters/llm/with-provider-fallback.js";
import { withSystemRoleFallback } from "../../src/adapters/llm/with-system-role-fallback.js";
import { withToolChoiceRetry } from "../../src/adapters/llm/with-tool-choice-retry.js";

function stubResponse(text: string): ChatResponse {
  return {
    text,
    tool_calls: [],
    finish_reason: "stop",
    model: "stub-model",
  };
}

const baseReq: ChatRequest = {
  model: "stub-model",
  messages: [
    { role: "system", content: "you are a bot" },
    { role: "user", content: "hi" },
  ],
};

describe("defaultIsTransient", () => {
  it("flags HTTP 5xx transients", () => {
    expect(defaultIsTransient({ status: 502 })).toBe(true);
    expect(defaultIsTransient({ status: 503 })).toBe(true);
    expect(defaultIsTransient({ status: 529 })).toBe(true);
    expect(defaultIsTransient({ status: 400 })).toBe(false);
  });

  it("flags node fetch errors", () => {
    expect(defaultIsTransient({ code: "ETIMEDOUT" })).toBe(true);
    expect(defaultIsTransient({ code: "ECONNRESET" })).toBe(true);
    expect(defaultIsTransient({ code: "EBADF" })).toBe(false);
  });

  it("flags timeouts / overloaded messages", () => {
    expect(defaultIsTransient(new Error("Request timeout after 30s"))).toBe(true);
    expect(defaultIsTransient(new Error("temporarily unavailable"))).toBe(true);
    expect(defaultIsTransient(new Error("model overloaded"))).toBe(true);
    expect(defaultIsTransient(new Error("invalid api key"))).toBe(false);
  });
});

describe("withProviderFallback", () => {
  it("returns primary result when it succeeds", async () => {
    const primary: LLMClient = { chat: vi.fn(async () => stubResponse("primary")) };
    const fallback: LLMClient = { chat: vi.fn(async () => stubResponse("fallback")) };
    const wrapped = withProviderFallback({ primary, fallbacks: [fallback], logger: nullLogger });
    const res = await wrapped.chat(baseReq);
    expect(res.text).toBe("primary");
    expect(fallback.chat).not.toHaveBeenCalled();
  });

  it("cascades to fallback on transient failure", async () => {
    const primary: LLMClient = {
      chat: vi.fn(async () => {
        throw Object.assign(new Error("upstream 502"), { status: 502 });
      }),
    };
    const fallback: LLMClient = { chat: vi.fn(async () => stubResponse("recovered")) };
    const wrapped = withProviderFallback({ primary, fallbacks: [fallback], logger: nullLogger });
    const res = await wrapped.chat(baseReq);
    expect(res.text).toBe("recovered");
    expect(primary.chat).toHaveBeenCalledTimes(1);
    expect(fallback.chat).toHaveBeenCalledTimes(1);
  });

  it("fails fast on non-transient error", async () => {
    const primary: LLMClient = {
      chat: vi.fn(async () => {
        throw Object.assign(new Error("bad request"), { status: 400 });
      }),
    };
    const fallback: LLMClient = { chat: vi.fn(async () => stubResponse("secondary")) };
    const wrapped = withProviderFallback({ primary, fallbacks: [fallback], logger: nullLogger });
    await expect(wrapped.chat(baseReq)).rejects.toThrow(/bad request/);
    expect(fallback.chat).not.toHaveBeenCalled();
  });

  it("rethrows last error when all providers fail transiently", async () => {
    const mk = (label: string) => ({
      chat: vi.fn(async () => {
        throw Object.assign(new Error(`${label} timeout`), { status: 503 });
      }),
    });
    const primary = mk("p");
    const secondary = mk("s");
    const wrapped = withProviderFallback({
      primary,
      fallbacks: [secondary],
      logger: nullLogger,
    });
    await expect(wrapped.chat(baseReq)).rejects.toThrow(/s timeout/);
  });
});

describe("withSystemRoleFallback", () => {
  it("passes through on success", async () => {
    const inner: LLMClient = { chat: vi.fn(async () => stubResponse("ok")) };
    const wrapped = withSystemRoleFallback({ inner, logger: nullLogger });
    const res = await wrapped.chat(baseReq);
    expect(res.text).toBe("ok");
    expect(inner.chat).toHaveBeenCalledTimes(1);
  });

  it("retries with embedded system role on rejection", async () => {
    const inner: LLMClient = {
      chat: vi
        .fn<[ChatRequest], Promise<ChatResponse>>()
        .mockRejectedValueOnce(new Error("this model does not support system role"))
        .mockResolvedValueOnce(stubResponse("recovered")),
    };
    const wrapped = withSystemRoleFallback({ inner, logger: nullLogger });
    const res = await wrapped.chat(baseReq);
    expect(res.text).toBe("recovered");
    const secondCall = (inner.chat as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as ChatRequest;
    expect(secondCall.messages.find((m) => m.role === "system")).toBeUndefined();
    const merged = secondCall.messages.find((m) => m.role === "user")!;
    expect(merged.content).toContain("[SYSTEM]");
    expect(merged.content).toContain("you are a bot");
    expect(merged.content).toContain("hi");
  });

  it("rethrows non-system-role errors", async () => {
    const inner: LLMClient = {
      chat: vi.fn(async () => {
        throw new Error("bad api key");
      }),
    };
    const wrapped = withSystemRoleFallback({ inner, logger: nullLogger });
    await expect(wrapped.chat(baseReq)).rejects.toThrow(/bad api key/);
    expect(inner.chat).toHaveBeenCalledTimes(1);
  });

  it("rethrows original when request has no system message to embed", async () => {
    const inner: LLMClient = {
      chat: vi.fn(async () => {
        throw new Error("system role not supported here");
      }),
    };
    const noSystem: ChatRequest = { model: "m", messages: [{ role: "user", content: "hi" }] };
    const wrapped = withSystemRoleFallback({ inner, logger: nullLogger });
    await expect(wrapped.chat(noSystem)).rejects.toThrow(/system role/);
    expect(inner.chat).toHaveBeenCalledTimes(1);
  });
});

describe("withToolChoiceRetry", () => {
  const reqWithRequired: ChatRequest = { ...baseReq, tool_choice: "required" };

  it("passes through on success", async () => {
    const inner: LLMClient = { chat: vi.fn(async () => stubResponse("ok")) };
    const wrapped = withToolChoiceRetry({ inner, logger: nullLogger });
    await wrapped.chat(reqWithRequired);
    expect(inner.chat).toHaveBeenCalledTimes(1);
  });

  it("retries with tool_choice=auto on rejection", async () => {
    const inner: LLMClient = {
      chat: vi
        .fn<[ChatRequest], Promise<ChatResponse>>()
        .mockRejectedValueOnce(new Error("tool_choice=required not supported"))
        .mockResolvedValueOnce(stubResponse("recovered")),
    };
    const wrapped = withToolChoiceRetry({ inner, logger: nullLogger });
    const res = await wrapped.chat(reqWithRequired);
    expect(res.text).toBe("recovered");
    const secondCall = (inner.chat as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as ChatRequest;
    expect(secondCall.tool_choice).toBe("auto");
  });

  it("retries with omitted tool_choice on second rejection", async () => {
    const inner: LLMClient = {
      chat: vi
        .fn<[ChatRequest], Promise<ChatResponse>>()
        .mockRejectedValueOnce(new Error("tool_choice invalid"))
        .mockRejectedValueOnce(new Error("tool_choice still no"))
        .mockResolvedValueOnce(stubResponse("recovered-2")),
    };
    const wrapped = withToolChoiceRetry({ inner, logger: nullLogger });
    const res = await wrapped.chat(reqWithRequired);
    expect(res.text).toBe("recovered-2");
    const thirdCall = (inner.chat as ReturnType<typeof vi.fn>).mock.calls[2]?.[0] as ChatRequest;
    expect(thirdCall.tool_choice).toBeUndefined();
  });

  it("rethrows non-tool-choice errors", async () => {
    const inner: LLMClient = {
      chat: vi.fn(async () => {
        throw new Error("rate limit exceeded");
      }),
    };
    const wrapped = withToolChoiceRetry({ inner, logger: nullLogger });
    await expect(wrapped.chat(reqWithRequired)).rejects.toThrow(/rate limit/);
    expect(inner.chat).toHaveBeenCalledTimes(1);
  });

  it("no-op when tool_choice already auto", async () => {
    const inner: LLMClient = {
      chat: vi.fn(async () => {
        throw new Error("tool_choice failed");
      }),
    };
    const wrapped = withToolChoiceRetry({ inner, logger: nullLogger });
    await expect(
      wrapped.chat({ ...baseReq, tool_choice: "auto" }),
    ).rejects.toThrow(/tool_choice failed/);
    expect(inner.chat).toHaveBeenCalledTimes(1);
  });
});

describe("composition", () => {
  it("stacks provider fallback + system role fallback + tool choice retry", async () => {
    // Primary fails transiently → fallback succeeds after tool_choice retry.
    const primary: LLMClient = {
      chat: vi.fn(async () => {
        throw Object.assign(new Error("upstream 503"), { status: 503 });
      }),
    };
    const fallbackInner: LLMClient = {
      chat: vi
        .fn<[ChatRequest], Promise<ChatResponse>>()
        .mockRejectedValueOnce(new Error("tool_choice invalid"))
        .mockResolvedValueOnce(stubResponse("composed")),
    };
    const fallback = withToolChoiceRetry({ inner: fallbackInner, logger: nullLogger });
    const wrapped = withProviderFallback({
      primary,
      fallbacks: [fallback],
      logger: nullLogger,
    });
    const res = await wrapped.chat({ ...baseReq, tool_choice: "required" });
    expect(res.text).toBe("composed");
  });
});
