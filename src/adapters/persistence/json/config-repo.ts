import { z } from "zod";
import type { ConfigError, ConfigRepo } from "../../../ports/config-repo.js";
import { parseAppConfig } from "../../../domain/config-load.js";
import { err, ok, type Result } from "../../../shared/result.js";
import { readJsonValidated } from "./atomic-write.js";
import type { AppConfig } from "../../../domain/schemas/config.js";

const RawJsonSchema: z.ZodType<unknown> = z.unknown();

export interface JsonConfigRepoOptions {
  filePath: string;
}

/**
 * Reads flat user-config.json → validates → maps to nested AppConfig → validates.
 * Two-stage errors distinguish "file broken" from "schema wrong."
 */
export function createJsonConfigRepo(opts: JsonConfigRepoOptions): ConfigRepo {
  return {
    async load(): Promise<Result<AppConfig, ConfigError>> {
      const raw = await readJsonValidated(opts.filePath, RawJsonSchema);
      if (!raw.ok) return err({ kind: "load", error: raw.error });
      const parsed = parseAppConfig(raw.value);
      if (!parsed.ok) return err({ kind: "parse", error: parsed.error });
      return ok(parsed.value);
    },
  };
}
