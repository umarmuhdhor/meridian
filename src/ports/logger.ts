export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(scope: string, msg: string, meta?: Record<string, unknown>): void;
  info(scope: string, msg: string, meta?: Record<string, unknown>): void;
  warn(scope: string, msg: string, meta?: Record<string, unknown>): void;
  error(scope: string, msg: string, meta?: Record<string, unknown>): void;
}

/** No-op logger — for tests + DRY_RUN where console spam gets in the way. */
export const nullLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
