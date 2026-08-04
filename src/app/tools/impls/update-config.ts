import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { FlatUserConfigSchema } from "../../../domain/schemas/config-flat.js";
import { flatToNested } from "../../../domain/config-load.js";
import { readJsonValidated, writeJsonAtomic } from "../../../adapters/persistence/json/atomic-write.js";
import type { AppConfig } from "../../../domain/schemas/config.js";

/** Unwrap optional/default/nullable/effects wrappers to the base zod type name. */
function baseTypeName(schema: z.ZodTypeAny | undefined): string | null {
  let s: z.ZodTypeAny | undefined = schema;
  const wrappers = new Set(["ZodOptional", "ZodDefault", "ZodNullable"]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  while (s && wrappers.has((s._def as any).typeName)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s = (s._def as any).innerType as z.ZodTypeAny;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return s ? ((s._def as any).typeName as string) : null;
}

/** Coerce a web-supplied value to the flat-config field's type (best effort). */
function coerce(fieldSchema: z.ZodTypeAny | undefined, val: unknown): unknown {
  const t = baseTypeName(fieldSchema);
  if (t === "ZodNumber") {
    const n = typeof val === "number" ? val : Number(val);
    return Number.isFinite(n) ? n : val;
  }
  if (t === "ZodBoolean") {
    if (typeof val === "boolean") return val;
    if (val === "true") return true;
    if (val === "false") return false;
    return val;
  }
  return val;
}

export const updateConfigTool = defineTool({
  name: "update_config",
  description:
    "Apply a batch of flat config changes to user-config.json (persisted + live-reloaded). Unknown keys are reported, not applied.",
  args: z.object({
    changes: z.record(z.string(), z.unknown()),
    reason: z.string().optional(),
  }),
  result: z.object({
    applied: z.record(z.string(), z.unknown()),
    unknown: z.array(z.string()),
    error: z.string().optional(),
  }),
  execute: async ({ changes }, ctx) => {
    const loaded = await readJsonValidated(ctx.configPath, FlatUserConfigSchema);
    if (!loaded.ok) {
      return { applied: {}, unknown: Object.keys(changes), error: `config not loadable: ${loaded.error.kind}` };
    }
    // Work on a raw clone (passthrough keeps extra keys); apply recognized changes.
    const flat: Record<string, unknown> = { ...(loaded.value as Record<string, unknown>) };
    const shape = FlatUserConfigSchema.shape as Record<string, z.ZodTypeAny>;
    const applied: Record<string, unknown> = {};
    const unknown: string[] = [];

    for (const [key, val] of Object.entries(changes)) {
      if (Object.prototype.hasOwnProperty.call(shape, key)) {
        const coerced = coerce(shape[key], val);
        flat[key] = coerced;
        applied[key] = coerced;
      } else {
        unknown.push(key);
      }
    }

    if (Object.keys(applied).length === 0) {
      return { applied, unknown };
    }

    const validated = FlatUserConfigSchema.safeParse(flat);
    if (!validated.success) {
      return {
        applied: {},
        unknown,
        error: validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      };
    }

    await writeJsonAtomic(ctx.configPath, validated.data);

    // Live-reload: mutate each config section in place so the running daemon picks it up.
    // Prefer in-place assign (preserves refs held by cycle closures); fall back to set if a
    // section is absent (only happens with partial configs, e.g. some unit-test contexts).
    const nested = flatToNested(validated.data);
    for (const section of Object.keys(nested) as (keyof AppConfig)[]) {
      const cur = ctx.config[section] as unknown;
      if (cur && typeof cur === "object") {
        Object.assign(cur as object, nested[section] as object);
      } else {
        (ctx.config as Record<string, unknown>)[section] = nested[section];
      }
    }

    return { applied, unknown };
  },
});
