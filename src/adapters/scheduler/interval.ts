import type { Logger } from "../../ports/logger.js";
import type { ScheduleHandle, ScheduledJob, Scheduler } from "../../ports/scheduler.js";

interface Slot {
  timer: NodeJS.Timeout;
  label: string;
  running: boolean;
}

/**
 * Real setInterval scheduler. Non-overlap enforced per slot: if a job is still executing
 * when its next tick arrives, the tick is skipped and logged (matches `_managementBusy`
 * pattern from index.js). Job errors don't kill the interval — they log + carry on.
 */
export function createIntervalScheduler(logger: Logger): Scheduler {
  const slots = new Set<Slot>();

  const scheduler: Scheduler = {
    every(intervalMs: number, job: ScheduledJob, label: string): ScheduleHandle {
      const slot: Slot = {
        label,
        running: false,
        timer: setInterval(() => {
          if (slot.running) {
            logger.warn("scheduler", `skip: ${label} still busy`);
            return;
          }
          slot.running = true;
          Promise.resolve()
            .then(job)
            .catch((e) => {
              logger.error("scheduler", `${label} threw: ${(e as Error).message}`);
            })
            .finally(() => {
              slot.running = false;
            });
        }, intervalMs),
      };
      slots.add(slot);
      logger.info("scheduler", `scheduled ${label} every ${intervalMs}ms`);
      return {
        cancel() {
          clearInterval(slot.timer);
          slots.delete(slot);
          logger.info("scheduler", `cancelled ${label}`);
        },
      };
    },
    cancelAll() {
      for (const s of slots) clearInterval(s.timer);
      slots.clear();
      logger.info("scheduler", "all jobs cancelled");
    },
  };
  return scheduler;
}
