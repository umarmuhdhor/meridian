import type { LogLevel, Logger } from "../../ports/logger.js";

export interface LogLine {
  ts: string;
  level: LogLevel;
  scope: string;
  msg: string;
  meta?: Record<string, unknown> | undefined;
}

export interface LogStore {
  /** Most-recent lines last. `limit` caps from the tail; `minLevel` filters by severity. */
  get(opts?: { limit?: number; minLevel?: LogLevel }): LogLine[];
}

export interface RingBufferLogger {
  logger: Logger;
  store: LogStore;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Wraps an inner Logger, tee-ing every line into a fixed-capacity in-memory ring
 * (oldest lines drop off — no disk growth). The daemon owns the ring; the dashboard
 * bridge reads it via a LogStore handle to serve GET /logs. Capturing here (not the
 * console adapter) keeps the console adapter a pure sink and lets the daemon opt in.
 */
export function createRingBufferLogger(inner: Logger, capacity = 1000): RingBufferLogger {
  const buf: LogLine[] = [];

  const push = (line: LogLine): void => {
    buf.push(line);
    if (buf.length > capacity) buf.splice(0, buf.length - capacity);
  };

  const wrap =
    (level: LogLevel, sink: Logger[LogLevel]) =>
    (scope: string, msg: string, meta?: Record<string, unknown>): void => {
      push({
        ts: new Date().toISOString(),
        level,
        scope,
        msg,
        meta: meta && Object.keys(meta).length > 0 ? meta : undefined,
      });
      sink(scope, msg, meta);
    };

  const logger: Logger = {
    debug: wrap("debug", inner.debug),
    info: wrap("info", inner.info),
    warn: wrap("warn", inner.warn),
    error: wrap("error", inner.error),
  };

  const store: LogStore = {
    get({ limit = 200, minLevel = "debug" } = {}) {
      const threshold = LEVEL_RANK[minLevel];
      const filtered = buf.filter((l) => LEVEL_RANK[l.level] >= threshold);
      return limit > 0 ? filtered.slice(-limit) : filtered;
    },
  };

  return { logger, store };
}
