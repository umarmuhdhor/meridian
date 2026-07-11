import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createRegistry } from "../../src/app/tools/registry.js";
import { executeTool } from "../../src/app/tools/execute.js";
import type { AppContext } from "../../src/app/tools/context.js";
import { makeCtx } from "../unit/tool-context.js";
import { mkTmpDir, rmDir } from "./tmpdir.js";
import { addLessonTool } from "../../src/app/tools/impls/add-lesson.js";
import { listLessonsTool } from "../../src/app/tools/impls/list-lessons.js";
import { pinLessonTool } from "../../src/app/tools/impls/pin-lesson.js";
import { clearLessonsTool } from "../../src/app/tools/impls/clear-lessons.js";
import { addStrategyTool } from "../../src/app/tools/impls/add-strategy.js";
import { setActiveStrategyTool } from "../../src/app/tools/impls/set-active-strategy.js";
import { removeStrategyTool } from "../../src/app/tools/impls/remove-strategy.js";
import { addSmartWalletTool } from "../../src/app/tools/impls/add-smart-wallet.js";
import { removeSmartWalletTool } from "../../src/app/tools/impls/remove-smart-wallet.js";
import { blockDeployerTool } from "../../src/app/tools/impls/block-deployer.js";
import { listBlockedDeployersTool } from "../../src/app/tools/impls/list-blocked-deployers.js";
import { unblockDeployerTool } from "../../src/app/tools/impls/unblock-deployer.js";
import { updateConfigTool } from "../../src/app/tools/impls/update-config.js";

const registry = createRegistry([
  addLessonTool, listLessonsTool, pinLessonTool, clearLessonsTool,
  addStrategyTool, setActiveStrategyTool, removeStrategyTool,
  addSmartWalletTool, removeSmartWalletTool,
  blockDeployerTool, listBlockedDeployersTool, unblockDeployerTool,
  updateConfigTool,
]);

const run = (ctx: AppContext, name: string, args: Record<string, unknown>) =>
  executeTool(registry, { name, args }, ctx);

describe("dashboard tools (control surface)", () => {
  it("add_lesson → list_lessons roundtrip", async () => {
    const ctx = makeCtx();
    const added = await run(ctx, "add_lesson", { rule: "PREFER high organic pools", tags: ["screening"] });
    expect(added.ok).toBe(true);
    const listed = await run(ctx, "list_lessons", {});
    expect(listed.ok).toBe(true);
    const lessons = (listed.value as { lessons: { rule: string }[] }).lessons;
    expect(lessons.some((l) => l.rule.includes("PREFER high organic"))).toBe(true);
  });

  it("pin then clear lessons", async () => {
    const ctx = makeCtx();
    const added = await run(ctx, "add_lesson", { rule: "AVOID low TVL" });
    const id = (added.value as { id: string }).id;
    const pinned = await run(ctx, "pin_lesson", { id });
    expect((pinned.value as { pinned: boolean }).pinned).toBe(true);
    const cleared = await run(ctx, "clear_lessons", { mode: "all" });
    expect((cleared.value as { cleared: number }).cleared).toBeGreaterThanOrEqual(1);
  });

  it("strategy add → set active → remove", async () => {
    const ctx = makeCtx();
    await run(ctx, "add_strategy", { id: "s1", name: "Test", lp_strategy: "spot" });
    const active = await run(ctx, "set_active_strategy", { id: "s1" });
    expect((active.value as { active: boolean }).active).toBe(true);
    const removed = await run(ctx, "remove_strategy", { id: "s1" });
    expect((removed.value as { removed: boolean }).removed).toBe(true);
  });

  it("smart wallet add → remove", async () => {
    const ctx = makeCtx();
    await run(ctx, "add_smart_wallet", { name: "KOL", address: "Wallet111", type: "lp" });
    const removed = await run(ctx, "remove_smart_wallet", { address: "Wallet111" });
    expect((removed.value as { removed: boolean }).removed).toBe(true);
  });

  it("block_deployer → list → unblock", async () => {
    const ctx = makeCtx();
    await run(ctx, "block_deployer", { wallet: "Dev111", reason: "rug" });
    const listed = await run(ctx, "list_blocked_deployers", {});
    const blocked = (listed.value as { blocked: { wallet: string }[] }).blocked;
    expect(blocked.some((b) => b.wallet === "Dev111")).toBe(true);
    const un = await run(ctx, "unblock_deployer", { wallet: "Dev111" });
    expect((un.value as { unblocked: boolean }).unblocked).toBe(true);
  });

  describe("update_config (batch, persist + live-reload)", () => {
    let dir: string;
    let cfgPath: string;
    beforeAll(async () => {
      dir = await mkTmpDir("updcfg");
      cfgPath = path.join(dir, "user-config.json");
      await copyFile(path.join(process.cwd(), "user-config.example.json"), cfgPath);
    });
    afterAll(async () => rmDir(dir));

    it("applies known keys, reports unknown, persists, and mutates live config", async () => {
      const ctx = makeCtx({ configPath: cfgPath });
      const before = ctx.config.risk.maxPositions;
      const r = await run(ctx, "update_config", {
        changes: { maxPositions: before + 2, stopLossPct: -40, bogusKey: 1 },
        reason: "dashboard",
      });
      expect(r.ok).toBe(true);
      const out = r.value as { applied: Record<string, unknown>; unknown: string[] };
      expect(out.applied.maxPositions).toBe(before + 2);
      expect(out.unknown).toContain("bogusKey");
      // live config mutated in place
      expect(ctx.config.risk.maxPositions).toBe(before + 2);
      expect(ctx.config.management.stopLossPct).toBe(-40);
      // persisted to disk (flat)
      const onDisk = JSON.parse(await readFile(cfgPath, "utf8")) as Record<string, unknown>;
      expect(onDisk.maxPositions).toBe(before + 2);
    });

    it("coerces string numbers/booleans from the web", async () => {
      const ctx = makeCtx({ configPath: cfgPath });
      const r = await run(ctx, "update_config", {
        changes: { gasReserve: "0.25", trailingTakeProfit: "false" },
        reason: "dashboard",
      });
      expect(r.ok).toBe(true);
      expect(ctx.config.management.gasReserve).toBe(0.25);
      expect(ctx.config.management.trailingTakeProfit).toBe(false);
    });
  });
});
