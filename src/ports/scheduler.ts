export type ScheduledJob = () => Promise<void> | void;

export interface ScheduleHandle {
  /** Cancel this scheduled job. Idempotent. */
  cancel(): void;
}

export interface Scheduler {
  /**
   * Fire `job` every `intervalMs`. First fire happens after `intervalMs` (not immediately).
   * If a previous invocation is still in flight, the next tick is SKIPPED (never queued).
   */
  every(intervalMs: number, job: ScheduledJob, label: string): ScheduleHandle;
  /** Cancel every scheduled job. Used at daemon shutdown. */
  cancelAll(): void;
}
