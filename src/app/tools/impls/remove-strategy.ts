import { z } from "zod";
import { defineTool } from "../define-tool.js";

export const removeStrategyTool = defineTool({
  name: "remove_strategy",
  description: "Remove a saved LP strategy from the library by id.",
  args: z.object({ id: z.string().min(1) }),
  result: z.object({ removed: z.boolean(), id: z.string() }),
  execute: async ({ id }, ctx) => ({ removed: await ctx.repos.strategies.remove(id), id }),
});
