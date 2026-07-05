import { z } from "zod";
import { defineTool } from "../define-tool.js";

const MAX_REASON_LEN = 280;

function sanitize(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").replace(/[<>]/g, "").trim().slice(0, MAX_REASON_LEN);
}

export const addToBlacklistTool = defineTool({
  name: "add_to_blacklist",
  description:
    "Add a token mint to the blacklist. Screening will hard-filter this mint from candidates before the LLM sees them.",
  args: z.object({
    mint: z.string().min(1),
    symbol: z.string().nullable().optional(),
    reason: z.string().min(3),
  }),
  result: z.object({
    added: z.literal(true),
    mint: z.string(),
    added_at: z.string(),
  }),
  execute: async (args, ctx) => {
    const added_at = ctx.clock.now().toISOString();
    await ctx.repos.tokenBlacklist.add(args.mint, {
      symbol: args.symbol ?? null,
      reason: sanitize(args.reason),
      added_at,
      added_by: "agent",
    });
    return { added: true as const, mint: args.mint, added_at };
  },
});
