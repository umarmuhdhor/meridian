import { describe, it, expect } from "vitest";
import { createManualScheduler } from "../../src/adapters/scheduler/manual.js";

describe("ManualScheduler", () => {
  it("fires job after each interval", async () => {
    const s = createManualScheduler();
    let count = 0;
    s.every(100, () => { count += 1; }, "job");
    await s.advance(50);
    expect(count).toBe(0);
    await s.advance(50);
    expect(count).toBe(1);
    await s.advance(100);
    expect(count).toBe(2);
    await s.advance(250);
    expect(count).toBe(4);
  });

  it("cancel stops future fires", async () => {
    const s = createManualScheduler();
    let count = 0;
    const handle = s.every(100, () => { count += 1; }, "job");
    await s.advance(100);
    expect(count).toBe(1);
    handle.cancel();
    await s.advance(1000);
    expect(count).toBe(1);
  });

  it("cancelAll stops every job", async () => {
    const s = createManualScheduler();
    let a = 0;
    let b = 0;
    s.every(100, () => { a += 1; }, "a");
    s.every(50, () => { b += 1; }, "b");
    await s.advance(100);
    expect(a).toBe(1);
    expect(b).toBe(2);
    s.cancelAll();
    await s.advance(1000);
    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  it("independent jobs fire at their own cadence", async () => {
    const s = createManualScheduler();
    const events: string[] = [];
    s.every(100, () => { events.push("A"); }, "A");
    s.every(150, () => { events.push("B"); }, "B");
    await s.advance(300);
    // A fires at 100, 200, 300 = 3 times; B fires at 150, 300 = 2 times
    expect(events.filter((e) => e === "A")).toHaveLength(3);
    expect(events.filter((e) => e === "B")).toHaveLength(2);
  });

  it("pause suspends ticks until resume; timeline resumes at real cadence", async () => {
    const s = createManualScheduler();
    let count = 0;
    s.every(100, () => { count += 1; }, "job");
    await s.advance(100);
    expect(count).toBe(1);
    expect(s.isPaused()).toBe(false);
    s.pause();
    expect(s.isPaused()).toBe(true);
    await s.advance(500);
    expect(count).toBe(1); // paused → no fires
    s.resume();
    expect(s.isPaused()).toBe(false);
    await s.advance(100);
    expect(count).toBe(2);
  });

  it("pause and resume are idempotent", async () => {
    const s = createManualScheduler();
    let count = 0;
    s.every(100, () => { count += 1; }, "job");
    s.pause();
    s.pause();
    expect(s.isPaused()).toBe(true);
    await s.advance(300);
    expect(count).toBe(0);
    s.resume();
    s.resume();
    expect(s.isPaused()).toBe(false);
    await s.advance(100);
    expect(count).toBe(1);
  });

  it("awaits each job before advancing simulated time", async () => {
    // ManualScheduler runs jobs sequentially inside advance. Real overlap-skip semantics
    // are enforced by the setInterval adapter (which cannot be tested without real timers).
    const s = createManualScheduler();
    const events: string[] = [];
    s.every(100, async () => {
      events.push("start");
      await Promise.resolve();
      events.push("end");
    }, "slow");
    await s.advance(300);
    // 3 fires × (start,end) — each fully completes before the next starts
    expect(events).toEqual(["start", "end", "start", "end", "start", "end"]);
  });
});
