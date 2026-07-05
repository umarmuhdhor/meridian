import { describe, it, expect, vi } from "vitest";
import { fixedClock, systemClock } from "../../src/ports/clock.js";
import { nullLogger } from "../../src/ports/logger.js";
import type { HiveMindClient } from "../../src/ports/hivemind.js";
import {
  createAgentMeridianHiveMind,
  type FetchImpl,
} from "../../src/adapters/hivemind/agent-meridian.js";
import { createHiveMindSync } from "../../src/app/hivemind/sync.js";
import { createManualScheduler } from "../../src/adapters/scheduler/manual.js";

const clock = fixedClock("2026-07-05T12:00:00.000Z");

function jsonRes(body: unknown, status = 200): Awaited<ReturnType<FetchImpl>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("createAgentMeridianHiveMind — enable gate", () => {
  it("shortcuts every method when disabled", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({}));
    const c = createAgentMeridianHiveMind({
      logger: nullLogger,
      clock,
      enabled: false,
      agentId: "agent-1",
      fetchImpl,
    });
    expect(c.isEnabled()).toBe(false);
    await c.registerAgent("boot");
    const p = await c.pushLesson({ id: "L", rule: "x", tags: [], pinned: false });
    expect(p.ok).toBe(false);
    expect(await c.pullLessons()).toBeNull();
    expect(await c.pullPresets()).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("shortcuts when agentId is empty", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({}));
    const c = createAgentMeridianHiveMind({
      logger: nullLogger,
      clock,
      enabled: true,
      agentId: "",
      fetchImpl,
    });
    expect(c.isEnabled()).toBe(false);
    await c.registerAgent();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("createAgentMeridianHiveMind — push", () => {
  it("posts lessons + performance and returns ok on 2xx", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn<FetchImpl>(async (url: string, init) => {
      calls.push(`${init?.method ?? "?"} ${url.split("/api/hivemind")[1]}`);
      return jsonRes({ ok: true });
    });
    const c = createAgentMeridianHiveMind({
      logger: nullLogger,
      clock,
      enabled: true,
      agentId: "agent-42",
      fetchImpl,
    });
    expect((await c.pushLesson({ id: "L1", rule: "x", tags: [], pinned: false })).ok).toBe(true);
    expect((await c.pushPerformance({
      position: "P1",
      pnl_pct: 5,
      close_reason: "TAKE_PROFIT",
      recorded_at: "2026-07-05T12:00:00.000Z",
    })).ok).toBe(true);
    expect(calls).toEqual([
      "POST /lessons/push",
      "POST /performance/push",
    ]);
  });

  it("returns ok=false + reason on non-2xx", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({ err: 1 }, 500));
    const c = createAgentMeridianHiveMind({
      logger: nullLogger,
      clock,
      enabled: true,
      agentId: "a",
      fetchImpl,
    });
    const r = await c.pushLesson({ id: "L", rule: "x", tags: [], pinned: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("500");
  });

  it("returns ok=false without throwing when fetch itself throws", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => {
      throw new Error("network down");
    });
    const c = createAgentMeridianHiveMind({
      logger: nullLogger,
      clock,
      enabled: true,
      agentId: "a",
      fetchImpl,
    });
    const r = await c.pushLesson({ id: "L", rule: "x", tags: [], pinned: false });
    expect(r.ok).toBe(false);
  });
});

describe("createAgentMeridianHiveMind — pull", () => {
  it("normalizes shared lessons", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () =>
      jsonRes({
        lessons: [
          { id: "L1", rule: "x", score: "7", tags: ["a"], source_agent_id: "peer-1" },
          { id: "L2", rule: "y" },
        ],
      }),
    );
    const c = createAgentMeridianHiveMind({
      logger: nullLogger,
      clock,
      enabled: true,
      agentId: "a",
      fetchImpl,
    });
    const lessons = await c.pullLessons(5);
    expect(lessons).toHaveLength(2);
    expect(lessons?.[0]?.score).toBe(7);
    expect(lessons?.[0]?.source_agent_id).toBe("peer-1");
    expect(lessons?.[1]?.tags).toEqual([]);
  });

  it("returns null on pull HTTP failure", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({}, 500));
    const c = createAgentMeridianHiveMind({
      logger: nullLogger,
      clock,
      enabled: true,
      agentId: "a",
      fetchImpl,
    });
    expect(await c.pullLessons()).toBeNull();
    expect(await c.pullPresets()).toBeNull();
  });

  it("returns empty array when body is unrecognized (soft-fail)", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonRes({ nope: true }));
    const c = createAgentMeridianHiveMind({
      logger: nullLogger,
      clock,
      enabled: true,
      agentId: "a",
      fetchImpl,
    });
    expect(await c.pullLessons()).toEqual([]);
  });
});

describe("createHiveMindSync", () => {
  function stubClient(overrides: Partial<HiveMindClient> = {}): HiveMindClient {
    const base: HiveMindClient = {
      isEnabled: () => true,
      agentId: () => "a",
      registerAgent: vi.fn(async () => {}) as unknown as HiveMindClient["registerAgent"],
      pushLesson: async () => ({ ok: true }),
      pushPerformance: async () => ({ ok: true }),
      pullLessons: vi.fn(async () => [
        { id: "L1", rule: "shared 1", score: 5, tags: [], source_agent_id: null },
      ]),
      pullPresets: vi.fn(async () => [{ id: "P1", name: "conservative", data: {} }]),
    };
    return { ...base, ...overrides };
  }

  it("runs a startup pass immediately and populates snapshot", async () => {
    const scheduler = createManualScheduler(0);
    const client = stubClient();
    const sync = createHiveMindSync({
      clock: systemClock,
      logger: nullLogger,
      scheduler,
      client,
    });
    // Give the microtask queue a chance to run.
    await new Promise((r) => setTimeout(r, 5));
    const s = sync.snapshot();
    expect(s.sharedLessons).toHaveLength(1);
    expect(s.presets).toHaveLength(1);
    expect(s.pulledAt).not.toBeNull();
    sync.stop();
  });

  it("keeps previous snapshot when a pull returns null", async () => {
    const scheduler = createManualScheduler(0);
    let firstCall = true;
    const client = stubClient({
      pullLessons: vi.fn(async () => {
        if (firstCall) {
          firstCall = false;
          return [{ id: "L1", rule: "first", score: 1, tags: [], source_agent_id: null }];
        }
        return null;
      }),
    });
    const sync = createHiveMindSync({
      clock: systemClock,
      logger: nullLogger,
      scheduler,
      client,
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(sync.snapshot().sharedLessons).toHaveLength(1);

    await scheduler.advance(15 * 60_000);
    expect(sync.snapshot().sharedLessons).toHaveLength(1); // still the previous one
    sync.stop();
  });

  it("shortcuts entirely when client is disabled", async () => {
    const scheduler = createManualScheduler(0);
    const register = vi.fn(async () => {});
    const client = stubClient({
      isEnabled: () => false,
      registerAgent: register as unknown as HiveMindClient["registerAgent"],
    });
    createHiveMindSync({
      clock: systemClock,
      logger: nullLogger,
      scheduler,
      client,
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(register).not.toHaveBeenCalled();
  });
});
