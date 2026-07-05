import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineTool } from "../../src/app/tools/define-tool.js";
import { createRegistry, ToolRegistry } from "../../src/app/tools/registry.js";

const echo = defineTool({
  name: "echo",
  description: "echo",
  args: z.object({ msg: z.string() }),
  result: z.object({ msg: z.string() }),
  execute: ({ msg }) => ({ msg }),
});

const ping = defineTool({
  name: "ping",
  description: "ping",
  args: z.object({}),
  result: z.object({ ok: z.literal(true) }),
  execute: () => ({ ok: true as const }),
});

describe("ToolRegistry", () => {
  it("register + get + has + names", () => {
    const r = new ToolRegistry();
    r.register(echo);
    expect(r.has("echo")).toBe(true);
    expect(r.has("nope")).toBe(false);
    expect(r.get("echo")).toBe(echo);
    expect(r.names()).toEqual(["echo"]);
  });

  it("registerAll adds many", () => {
    const r = createRegistry([echo, ping]);
    expect(r.all()).toHaveLength(2);
    expect(new Set(r.names())).toEqual(new Set(["echo", "ping"]));
  });

  it("duplicate names throw", () => {
    const r = new ToolRegistry();
    r.register(echo);
    expect(() => r.register(echo)).toThrow(/Duplicate tool name: echo/);
  });

  it("subset filters and preserves given order, drops unknown names silently", () => {
    const r = createRegistry([echo, ping]);
    const sub = r.subset(["ping", "unknown", "echo"]);
    expect(sub.map((t) => t.name)).toEqual(["ping", "echo"]);
  });
});
