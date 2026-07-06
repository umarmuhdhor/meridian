import type { ScheduleHandle, ScheduledJob, Scheduler } from "../../ports/scheduler.js";

interface ManualSlot {
  intervalMs: number;
  label: string;
  job: ScheduledJob;
  nextFireAt: number;
  running: boolean;
  cancelled: boolean;
}

export interface ManualScheduler extends Scheduler {
  /** Advance simulated time by `deltaMs` — any job whose next fire is due runs. Blocking. */
  advance(deltaMs: number): Promise<void>;
  /** How many jobs are scheduled + currently running. */
  stats(): { scheduled: number; running: number };
}

/**
 * Deterministic scheduler for tests. Time only moves when `advance()` is called.
 * Non-overlap semantics match the real interval scheduler: a still-running job means the
 * upcoming tick is skipped, not queued.
 */
export function createManualScheduler(startMs = 0): ManualScheduler {
  const slots = new Set<ManualSlot>();
  let now = startMs;
  let paused = false;

  const scheduler: ManualScheduler = {
    every(intervalMs, job, label): ScheduleHandle {
      const slot: ManualSlot = {
        intervalMs,
        label,
        job,
        nextFireAt: now + intervalMs,
        running: false,
        cancelled: false,
      };
      slots.add(slot);
      return {
        cancel() {
          slot.cancelled = true;
          slots.delete(slot);
        },
      };
    },
    cancelAll() {
      for (const s of slots) s.cancelled = true;
      slots.clear();
    },
    async advance(deltaMs: number) {
      const target = now + deltaMs;
      while (true) {
        let due: ManualSlot | undefined;
        for (const s of slots) {
          if (s.cancelled) continue;
          if (s.nextFireAt > target) continue;
          if (due == null || s.nextFireAt < due.nextFireAt) due = s;
        }
        if (!due) break;
        now = due.nextFireAt;
        due.nextFireAt += due.intervalMs;
        if (paused) continue;
        if (due.running) continue;
        due.running = true;
        try {
          await due.job();
        } finally {
          due.running = false;
        }
      }
      now = target;
    },
    stats() {
      let running = 0;
      for (const s of slots) if (s.running) running += 1;
      return { scheduled: slots.size, running };
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    isPaused() {
      return paused;
    },
  };
  return scheduler;
}
