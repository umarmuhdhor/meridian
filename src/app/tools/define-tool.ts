import type { z } from "zod";
import type { ToolDef } from "./types.js";

/**
 * Identity helper for tool definitions. Exists so a tool file reads:
 *   export const myTool = defineTool({ ... });
 * and the caller gets full type inference on args/result from the Zod schemas.
 */
export function defineTool<
  TArgsSchema extends z.ZodTypeAny,
  TResultSchema extends z.ZodTypeAny,
>(def: ToolDef<TArgsSchema, TResultSchema>): ToolDef<TArgsSchema, TResultSchema> {
  return def;
}
