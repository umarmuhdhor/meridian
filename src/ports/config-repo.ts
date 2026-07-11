import type { LoadError } from "../adapters/persistence/json/atomic-write.js";
import type { AppConfig } from "../domain/schemas/config.js";
import type { ConfigLoadError } from "../domain/config-load.js";
import type { Result } from "../shared/result.js";

export type ConfigError =
  | { kind: "load"; error: LoadError }
  | { kind: "parse"; error: ConfigLoadError };

export interface ConfigRepo {
  load(): Promise<Result<AppConfig, ConfigError>>;
}
