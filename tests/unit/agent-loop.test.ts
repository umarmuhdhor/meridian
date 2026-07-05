import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineTool } from "../../src/app/tools/define-tool.js";
import { createRegistry } from "../../src/app/tools/registry.js";
import { runAgentLoop } from "../../src/app/agent/loop.js";
import { createFakeLLM } from "../../src/adapters/llm/fake.js";
import { makeCtx } from "./tool-context.js";

const ping = defineTool({
  name: "ping",
  description: "returns pong",
  args: z.object({}),
  result: z.object({ pong: z.literal(true) }),
  execute: () => ({ pong: true as const }),
});

const add = defineTool({
  name: "add",
  description: "adds two numbers",
  args: z.object({ a: z.number(), b: z.number() }),
  result: z.object({ sum: z.number() }),
  execute: ({ a, b }) => ({ sum: a + b }),
});

const closeOnce = defineTool({
  name: "close_position",
  description: "close a position",
  args: z.object({ pos: z.string() }),
  result: z.object({ ok: z.literal(true) }),
  oncePerSession: true,
  execute: () => ({ ok: true as const }),
});

const registry = createRegistry([ping, add, closeOnce]);

const baseOpts = {
  role: "GENERAL" as const,
  goal: "ping the system",
  systemPrompt: "You are a test agent.",
  model: "fake/model",
};

describe("runAgentLoop", () => {
  it("terminates on final assistant text (single-step)", async () => {
    const llm = createFakeLLM({ script: [{ kind: "assistant", text: "hello world" }] });
    const r = await runAgentLoop({ llm, registry, ctx: makeCtx() }, baseOpts);
    expect(r.text).toBe("hello world");
    expect(r.steps).toBe(1);
    expect(r.finishReason).toBe("stop");
    expect(r.toolCalls).toEqual([]);
  });

  it("executes a tool then returns final text", async () => {
    const llm = createFakeLLM({
      script: [
        { kind: "tool_calls", calls: [{ name: "ping", args: {} }] },
        { kind: "assistant", text: "pong received" },
      ],
    });
    const r = await runAgentLoop({ llm, registry, ctx: makeCtx() }, baseOpts);
    expect(r.text).toBe("pong received");
    expect(r.steps).toBe(2);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]?.name).toBe("ping");
    expect(r.toolCalls[0]?.ok).toBe(true);
    // messages: system, user, assistant(tool_calls), tool, assistant(final)
    expect(r.messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
  });

  it("chains multiple tool calls (2 tools then done)", async () => {
    const llm = createFakeLLM({
      script: [
        { kind: "tool_calls", calls: [{ name: "add", args: { a: 2, b: 3 } }] },
        { kind: "tool_calls", calls: [{ name: "add", args: { a: 5, b: 4 } }] },
        { kind: "assistant", text: "final=9" },
      ],
    });
    const r = await runAgentLoop({ llm, registry, ctx: makeCtx() }, baseOpts);
    expect(r.text).toBe("final=9");
    expect(r.toolCalls).toHaveLength(2);
    expect(r.toolCalls[0]?.result).toEqual({ sum: 5 });
    expect(r.toolCalls[1]?.result).toEqual({ sum: 9 });
  });

  it("stops at max_steps ceiling", async () => {
    const llm = createFakeLLM({
      script: [
        { kind: "tool_calls", calls: [{ name: "ping", args: {} }] },
        { kind: "tool_calls", calls: [{ name: "ping", args: {} }] },
        { kind: "tool_calls", calls: [{ name: "ping", args: {} }] },
      ],
    });
    const r = await runAgentLoop({ llm, registry, ctx: makeCtx() }, { ...baseOpts, maxSteps: 3 });
    expect(r.finishReason).toBe("max_steps");
    expect(r.steps).toBe(3);
  });

  it("session lock: oncePerSession blocks second call", async () => {
    const llm = createFakeLLM({
      script: [
        { kind: "tool_calls", calls: [{ name: "close_position", args: { pos: "posA" } }] },
        { kind: "tool_calls", calls: [{ name: "close_position", args: { pos: "posB" } }] },
        { kind: "assistant", text: "done" },
      ],
    });
    const r = await runAgentLoop({ llm, registry, ctx: makeCtx() }, baseOpts);
    expect(r.locks).toContain("close_position");
    expect(r.toolCalls).toHaveLength(2);
    expect(r.toolCalls[0]?.ok).toBe(true);
    expect(r.toolCalls[1]?.ok).toBe(false);
    if (r.toolCalls[1]?.error?.kind === "safety_blocked") {
      expect(r.toolCalls[1].error.reason).toMatch(/already fired/);
    } else {
      throw new Error("expected safety_blocked error");
    }
  });

  it("no-tool retry: injects reminder once, terminates on second text-only", async () => {
    const llm = createFakeLLM({
      script: [
        { kind: "assistant", text: "sure I will do it" },
        { kind: "assistant", text: "still just text" },
      ],
    });
    const r = await runAgentLoop(
      { llm, registry, ctx: makeCtx() },
      { ...baseOpts, requireToolOnFirstStep: true },
    );
    expect(r.finishReason).toBe("no_tool_after_reminder");
    // Second-to-last message is the reminder
    const reminder = r.messages.find((m) => m.role === "user" && m.content.includes("must call a tool"));
    expect(reminder).toBeDefined();
  });

  it("no-tool retry: recovers when LLM calls a tool on retry", async () => {
    const llm = createFakeLLM({
      script: [
        { kind: "assistant", text: "sure I will" },
        { kind: "tool_calls", calls: [{ name: "ping", args: {} }] },
        { kind: "assistant", text: "done" },
      ],
    });
    const r = await runAgentLoop(
      { llm, registry, ctx: makeCtx() },
      { ...baseOpts, requireToolOnFirstStep: true },
    );
    expect(r.finishReason).toBe("stop");
    expect(r.text).toBe("done");
  });

  it("tool args validation error surfaces as safety-adjacent tool trace, loop continues", async () => {
    const llm = createFakeLLM({
      script: [
        { kind: "tool_calls", calls: [{ name: "add", args: { a: "nope", b: 3 } }] },
        { kind: "assistant", text: "handled" },
      ],
    });
    const r = await runAgentLoop({ llm, registry, ctx: makeCtx() }, baseOpts);
    expect(r.finishReason).toBe("stop");
    expect(r.toolCalls[0]?.ok).toBe(false);
    if (r.toolCalls[0]?.error) {
      expect(r.toolCalls[0].error.kind).toBe("args_invalid");
    }
  });

  it("passes tool_choice=required only on first step when requireToolOnFirstStep=true", async () => {
    const llm = createFakeLLM({
      script: [
        { kind: "tool_calls", calls: [{ name: "ping", args: {} }] },
        { kind: "assistant", text: "done" },
      ],
    });
    await runAgentLoop({ llm, registry, ctx: makeCtx() }, { ...baseOpts, requireToolOnFirstStep: true });
    const reqs = llm.requests();
    expect(reqs[0]?.tool_choice).toBe("required");
    expect(reqs[1]?.tool_choice).toBe("auto");
  });

  it("toolFilter restricts what schemas the LLM sees", async () => {
    const llm = createFakeLLM({ script: [{ kind: "assistant", text: "done" }] });
    await runAgentLoop(
      { llm, registry, ctx: makeCtx() },
      { ...baseOpts, toolFilter: ["ping"] },
    );
    const req = llm.requests()[0];
    expect(req?.tools?.map((t) => t.function.name)).toEqual(["ping"]);
  });

  it("onToolStart/onToolFinish hooks fire in order", async () => {
    const events: string[] = [];
    const llm = createFakeLLM({
      script: [
        { kind: "tool_calls", calls: [{ name: "ping", args: {} }] },
        { kind: "assistant", text: "done" },
      ],
    });
    await runAgentLoop(
      { llm, registry, ctx: makeCtx() },
      {
        ...baseOpts,
        onToolStart: (n) => {
          events.push(`start:${n}`);
        },
        onToolFinish: (n, ok) => {
          events.push(`finish:${n}:${ok}`);
        },
      },
    );
    expect(events).toEqual(["start:ping", "finish:ping:true"]);
  });
});
