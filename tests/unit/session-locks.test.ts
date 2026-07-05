import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createSessionLocks } from "../../src/app/agent/session-locks.js";
import { defineTool } from "../../src/app/tools/define-tool.js";

const oncePerSession = defineTool({
  name: "close_position",
  description: "close",
  args: z.object({}),
  result: z.object({}),
  oncePerSession: true,
  execute: () => ({}),
});

const noRetry = defineTool({
  name: "deploy_position",
  description: "deploy",
  args: z.object({}),
  result: z.object({}),
  oncePerSession: true,
  noRetry: true,
  execute: () => ({}),
});

const plain = defineTool({
  name: "get_active_bin",
  description: "read",
  args: z.object({}),
  result: z.object({}),
  execute: () => ({}),
});

describe("SessionLocks", () => {
  it("plain tools never lock", () => {
    const l = createSessionLocks();
    l.recordAfter(plain.name, true, plain);
    l.recordAfter(plain.name, false, plain);
    expect(l.checkBefore(plain.name).blocked).toBe(false);
  });

  it("oncePerSession locks after success only", () => {
    const l = createSessionLocks();
    l.recordAfter(oncePerSession.name, false, oncePerSession);
    expect(l.checkBefore(oncePerSession.name).blocked).toBe(false);
    l.recordAfter(oncePerSession.name, true, oncePerSession);
    const g = l.checkBefore(oncePerSession.name);
    expect(g.blocked).toBe(true);
    expect(g.reason).toContain("already fired");
  });

  it("noRetry locks after first attempt regardless of outcome", () => {
    const l = createSessionLocks();
    l.recordAfter(noRetry.name, false, noRetry);
    expect(l.checkBefore(noRetry.name).blocked).toBe(true);
  });

  it("locked() lists lock names", () => {
    const l = createSessionLocks();
    l.recordAfter(oncePerSession.name, true, oncePerSession);
    l.recordAfter(noRetry.name, false, noRetry);
    expect(new Set(l.locked())).toEqual(new Set(["close_position", "deploy_position"]));
  });
});
