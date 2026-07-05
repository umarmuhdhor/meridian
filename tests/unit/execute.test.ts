import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineTool } from "../../src/app/tools/define-tool.js";
import { createRegistry } from "../../src/app/tools/registry.js";
import { executeTool, formatToolError } from "../../src/app/tools/execute.js";
import { makeCtx } from "./tool-context.js";

const echo = defineTool({
  name: "echo",
  description: "echo",
  args: z.object({ msg: z.string() }),
  result: z.object({ msg: z.string() }),
  execute: ({ msg }) => ({ msg }),
});

const gated = defineTool({
  name: "gated",
  description: "gated",
  args: z.object({ user: z.string() }),
  result: z.object({ user: z.string() }),
  safety: [
    ({ user }) => (user === "banned" ? { reason: "user is banned" } : null),
  ],
  execute: ({ user }) => ({ user }),
});

const broken = defineTool({
  name: "broken",
  description: "broken",
  args: z.object({}),
  result: z.object({ n: z.number() }),
  execute: () => {
    throw new Error("kaboom");
  },
});

const badResult = defineTool({
  name: "bad_result",
  description: "bad_result",
  args: z.object({}),
  result: z.object({ n: z.number() }),
  execute: () => ({ n: "not-a-number" as unknown as number }),
});

const ctx = makeCtx();

describe("executeTool", () => {
  it("returns unknown_tool when name not registered", async () => {
    const r = await executeTool(createRegistry([echo]), { name: "missing", args: {} }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("unknown_tool");
  });

  it("parses JSON string args", async () => {
    const r = await executeTool(createRegistry([echo]), { name: "echo", args: '{"msg":"hi"}' }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ msg: "hi" });
  });

  it("jsonrepair rescues malformed args", async () => {
    const r = await executeTool(
      createRegistry([echo]),
      { name: "echo", args: "{msg: 'hi'}" }, // single quotes + bare key
      ctx,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ msg: "hi" });
  });

  it("args_parse_failed when repair disabled and JSON invalid", async () => {
    const r = await executeTool(
      createRegistry([echo]),
      { name: "echo", args: "not-json" },
      ctx,
      { attemptJsonRepair: false },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("args_parse_failed");
  });

  it("args_invalid when Zod rejects", async () => {
    const r = await executeTool(createRegistry([echo]), { name: "echo", args: { msg: 123 } }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("args_invalid");
  });

  it("empty string args → treated as {}", async () => {
    const r = await executeTool(createRegistry([broken]), { name: "broken", args: "" }, ctx);
    // broken tool throws — but args parsing succeeded first, so we hit execute_failed
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("execute_failed");
  });

  it("safety_blocked short-circuits execute", async () => {
    const r = await executeTool(createRegistry([gated]), { name: "gated", args: { user: "banned" } }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("safety_blocked");
      if (r.error.kind === "safety_blocked") expect(r.error.reason).toBe("user is banned");
    }
  });

  it("safety pass → executes normally", async () => {
    const r = await executeTool(createRegistry([gated]), { name: "gated", args: { user: "alice" } }, ctx);
    expect(r.ok).toBe(true);
  });

  it("execute_failed when tool throws", async () => {
    const r = await executeTool(createRegistry([broken]), { name: "broken", args: {} }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("execute_failed");
      if (r.error.kind === "execute_failed") expect(r.error.message).toBe("kaboom");
    }
  });

  it("result_invalid when tool returns wrong shape", async () => {
    const r = await executeTool(createRegistry([badResult]), { name: "bad_result", args: {} }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("result_invalid");
  });
});

describe("formatToolError", () => {
  it("renders a readable message per kind", () => {
    expect(formatToolError({ kind: "unknown_tool", name: "x" })).toContain("Unknown tool");
    expect(formatToolError({ kind: "safety_blocked", name: "gated", reason: "nope" })).toContain("nope");
    expect(formatToolError({ kind: "execute_failed", name: "b", message: "boom" })).toContain("boom");
  });
});
