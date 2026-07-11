import { z } from "zod";
import { defineTool } from "../define-tool.js";

export const addStrategyTool = defineTool({
  name: "add_strategy",
  description: "Add or replace a saved LP strategy in the strategy library.",
  args: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    lp_strategy: z.string().min(1),
    author: z.string().nullable().optional(),
    token_criteria: z.string().nullable().optional(),
    entry: z.string().nullable().optional(),
    range: z.string().nullable().optional(),
    exit: z.string().nullable().optional(),
    best_for: z.string().nullable().optional(),
    raw: z.string().nullable().optional(),
  }),
  result: z.object({
    added: z.literal(true),
    id: z.string(),
  }),
  execute: async (args, ctx) => {
    await ctx.repos.strategies.upsert({
      id: args.id,
      name: args.name,
      lp_strategy: args.lp_strategy,
      author: args.author ?? null,
      token_criteria: args.token_criteria ?? null,
      entry: args.entry ?? null,
      range: args.range ?? null,
      exit: args.exit ?? null,
      best_for: args.best_for ?? null,
      raw: args.raw ?? null,
    });
    return { added: true as const, id: args.id };
  },
});
