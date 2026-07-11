import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolRegistry } from "./registry.js";

export interface OpenAiToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Walks the registry, emits OpenAI's `tools` array shape from each tool's Zod args schema.
 * Replaces the hand-maintained `tools/definitions.js`. Adding a tool = writing one file;
 * the LLM contract updates automatically. No possibility of drift.
 */
export function generateOpenAiToolSchemas(registry: ToolRegistry): OpenAiToolSchema[] {
  return registry.all().map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: stripJsonSchemaMeta(
        zodToJsonSchema(tool.args, { target: "openApi3", $refStrategy: "none" }) as Record<string, unknown>,
      ),
    },
  }));
}

/** Drop `$schema`/`definitions` OpenAI doesn't accept in `parameters`. */
function stripJsonSchemaMeta(schema: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...schema };
  delete clone.$schema;
  delete clone.definitions;
  delete clone.$defs;
  return clone;
}
