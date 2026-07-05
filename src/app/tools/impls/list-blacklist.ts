import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { BlacklistEntrySchema } from "../../../domain/schemas/blacklist.js";

export const listBlacklistTool = defineTool({
  name: "list_blacklist",
  description: "List every blacklisted token mint with its reason and added timestamp.",
  args: z.object({}),
  result: z.object({
    count: z.number().int().nonnegative(),
    entries: z.array(z.object({ mint: z.string(), entry: BlacklistEntrySchema })),
  }),
  execute: async (_args, ctx) => {
    const entries = await ctx.repos.tokenBlacklist.list();
    return { count: entries.length, entries };
  },
});
