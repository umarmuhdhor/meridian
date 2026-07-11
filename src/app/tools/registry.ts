import type { AnyToolDef } from "./types.js";

/**
 * Loosened input type — accepts any specific tool from `defineTool<A, R>` without
 * generic-widening friction under `exactOptionalPropertyTypes`. Registry storage
 * is opaque; the concrete shape survives via `defineTool`'s inference.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RegistrableTool = { name: string } & Record<string, any>;

export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDef>();

  register(tool: RegistrableTool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as unknown as AnyToolDef);
    return this;
  }

  registerAll(tools: readonly RegistrableTool[]): this {
    for (const t of tools) this.register(t);
    return this;
  }

  get(name: string): AnyToolDef | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  names(): string[] {
    return Array.from(this.tools.keys());
  }

  all(): AnyToolDef[] {
    return Array.from(this.tools.values());
  }

  /** Filtered view — useful for role-scoped subsets (SCREENER / MANAGER / GENERAL). */
  subset(names: readonly string[]): AnyToolDef[] {
    const out: AnyToolDef[] = [];
    for (const n of names) {
      const t = this.tools.get(n);
      if (t) out.push(t);
    }
    return out;
  }
}

export function createRegistry(tools: readonly RegistrableTool[] = []): ToolRegistry {
  const r = new ToolRegistry();
  r.registerAll(tools);
  return r;
}
