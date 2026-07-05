import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { DecisionEntrySchema } from "../../../domain/schemas/decision.js";

export const getRecentDecisionsTool = defineTool({
  name: "get_recent_decisions",
  description: "Return the most recent structured decision-log entries (deploy/close/skip/no_deploy).",
  args: z.object({
    limit: z.number().int().positive().max(50).default(10),
  }),
  result: z.object({
    decisions: z.array(DecisionEntrySchema),
  }),
  execute: async ({ limit }, ctx) => ({
    decisions: await ctx.repos.decisions.recent(limit),
  }),
});
