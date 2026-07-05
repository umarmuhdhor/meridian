import type { LogLevel, Logger } from "../../ports/logger.js";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function fmt(level: LogLevel, scope: string, msg: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  return `${ts} [${level.toUpperCase()}] ${scope}: ${msg}${metaStr}`;
}

export function createConsoleLogger(minLevel: LogLevel = "info"): Logger {
  const threshold = LEVEL_RANK[minLevel];
  const emit = (level: LogLevel) => (scope: string, msg: string, meta?: Record<string, unknown>) => {
    if (LEVEL_RANK[level] < threshold) return;
    const line = fmt(level, scope, msg, meta);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
  };
}
