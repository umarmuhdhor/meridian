import { z } from "zod";
import { defineTool } from "../define-tool.js";

const MAX_LEN = 280;
const sanitize = (t: string): string =>
  t.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").replace(/[<>]/g, "").trim().slice(0, MAX_LEN);

export const setPositionNoteTool = defineTool({
  name: "set_position_note",
  description:
    "Attach a natural-language instruction/condition to an open position. The manager checks it every cycle and acts when the condition is met.",
  args: z.object({
    position_address: z.string().min(1),
    instruction: z.string().min(1),
  }),
  result: z.object({
    updated: z.boolean(),
    position_address: z.string(),
    instruction: z.string().nullable(),
  }),
  execute: async ({ position_address, instruction }, ctx) => {
    const pos = await ctx.repos.positions.get(position_address);
    if (!pos) {
      return { updated: false, position_address, instruction: null };
    }
    const clean = sanitize(instruction);
    await ctx.repos.positions.upsert({ ...pos, instruction: clean });
    return { updated: true, position_address, instruction: clean };
  },
});
