import { describe, it, expect } from "vitest";
import type { InboundMessage } from "../../src/ports/telegram-inbound.js";
import type { LLMClient } from "../../src/ports/llm-client.js";
import type { ToolRegistry } from "../../src/app/tools/registry.js";
import { routeTelegramMessage } from "../../src/app/telegram/router.js";
import { createManualScheduler } from "../../src/adapters/scheduler/manual.js";
import { createCollectingNotifier, type CollectingNotifier } from "../../src/adapters/notify/collecting-notifier.js";
import { makeCtx } from "./tool-context.js";

const throwingLlm: LLMClient = {
  chat: async () => {
    throw new Error("LLM should not be invoked for control commands");
  },
};

const emptyRegistry: ToolRegistry = {
  list: () => [],
  get: () => null,
  names: () => [],
};

function msg(text: string): InboundMessage {
  return {
    chatId: "chat",
    chatType: "private",
    userId: "user",
    username: "op",
    text,
    timestampMs: 0,
  };
}

function notifyTexts(n: CollectingNotifier): string[] {
  return n.recorded
    .filter((r): r is { type: "notify"; kind: "info" | "warn" | "error"; text: string } => r.type === "notify")
    .map((r) => r.text);
}

describe("routeTelegramMessage — control commands", () => {
  it("/pause suspends scheduler and acks", async () => {
    const notifier = createCollectingNotifier();
    const ctx = makeCtx({ notifier });
    const scheduler = createManualScheduler();
    scheduler.every(100, () => {}, "noop");

    await routeTelegramMessage(
      { ctx, llm: throwingLlm, registry: emptyRegistry, model: "x", scheduler },
      msg("/pause"),
    );

    expect(scheduler.isPaused()).toBe(true);
    expect(notifyTexts(notifier).join("\n")).toMatch(/paused/i);
  });

  it("/pause on already-paused reports state without re-pausing", async () => {
    const notifier = createCollectingNotifier();
    const ctx = makeCtx({ notifier });
    const scheduler = createManualScheduler();
    scheduler.pause();

    await routeTelegramMessage(
      { ctx, llm: throwingLlm, registry: emptyRegistry, model: "x", scheduler },
      msg("/pause"),
    );

    expect(scheduler.isPaused()).toBe(true);
    expect(notifyTexts(notifier).join("\n")).toMatch(/already paused/i);
  });

  it("/resume unpauses scheduler and acks", async () => {
    const notifier = createCollectingNotifier();
    const ctx = makeCtx({ notifier });
    const scheduler = createManualScheduler();
    scheduler.pause();

    await routeTelegramMessage(
      { ctx, llm: throwingLlm, registry: emptyRegistry, model: "x", scheduler },
      msg("/resume"),
    );

    expect(scheduler.isPaused()).toBe(false);
    expect(notifyTexts(notifier).join("\n")).toMatch(/resumed/i);
  });

  it("/resume on unpaused reports state", async () => {
    const notifier = createCollectingNotifier();
    const ctx = makeCtx({ notifier });
    const scheduler = createManualScheduler();

    await routeTelegramMessage(
      { ctx, llm: throwingLlm, registry: emptyRegistry, model: "x", scheduler },
      msg("/resume"),
    );

    expect(scheduler.isPaused()).toBe(false);
    expect(notifyTexts(notifier).join("\n")).toMatch(/already running/i);
  });

  it("/stop invokes shutdown fn with a reason and acks", async () => {
    const notifier = createCollectingNotifier();
    const ctx = makeCtx({ notifier });
    const scheduler = createManualScheduler();
    let stopped: string | null = null;
    const shutdown = (reason: string) => {
      stopped = reason;
    };

    await routeTelegramMessage(
      { ctx, llm: throwingLlm, registry: emptyRegistry, model: "x", scheduler, shutdown },
      msg("/stop"),
    );

    expect(stopped).toMatch(/telegram/i);
    expect(notifyTexts(notifier).join("\n")).toMatch(/shutting down/i);
  });

  it("/pause without scheduler dep reports unavailable", async () => {
    const notifier = createCollectingNotifier();
    const ctx = makeCtx({ notifier });

    await routeTelegramMessage(
      { ctx, llm: throwingLlm, registry: emptyRegistry, model: "x" },
      msg("/pause"),
    );

    expect(notifyTexts(notifier).join("\n")).toMatch(/unavailable/i);
  });

  it("/stop without shutdown dep reports unavailable", async () => {
    const notifier = createCollectingNotifier();
    const ctx = makeCtx({ notifier });

    await routeTelegramMessage(
      { ctx, llm: throwingLlm, registry: emptyRegistry, model: "x" },
      msg("/stop"),
    );

    expect(notifyTexts(notifier).join("\n")).toMatch(/unavailable/i);
  });

  it("/help mentions the new control commands", async () => {
    const notifier = createCollectingNotifier();
    const ctx = makeCtx({ notifier });

    await routeTelegramMessage(
      { ctx, llm: throwingLlm, registry: emptyRegistry, model: "x" },
      msg("/help"),
    );

    const text = notifyTexts(notifier).join("\n");
    expect(text).toMatch(/\/pause/);
    expect(text).toMatch(/\/resume/);
    expect(text).toMatch(/\/stop/);
  });
});
