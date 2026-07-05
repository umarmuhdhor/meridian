import { z } from "zod";
import { defineTool } from "../define-tool.js";
import { TokenInfoSchema } from "../../../domain/schemas/market.js";

export const getTokenInfoTool = defineTool({
  name: "get_token_info",
  description: "Return token metadata: symbol, launchpad, deployer, supply, mcap, holder count, age.",
  args: z.object({
    mint: z.string().min(1),
  }),
  result: TokenInfoSchema,
  execute: async ({ mint }, ctx) => ctx.market.tokenInfo.getInfo(mint),
});
