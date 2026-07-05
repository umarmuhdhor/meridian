import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { TokenNarrativeSchema } from "../../../domain/schemas/market.js";

export const getTokenNarrativeTool = defineTool({
  name: "get_token_narrative",
  description: "Return the narrative + tags for a token (theme / meme / utility categorization).",
  args: z.object({
    mint: z.string().min(1),
  }),
  result: TokenNarrativeSchema,
  execute: async ({ mint }, ctx) => ctx.market.tokenInfo.getNarrative(mint),
});
