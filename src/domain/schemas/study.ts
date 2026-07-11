import { z } from "zod";

/**
 * A top LP-er pattern from Agent Meridian's /top-lp study. The upstream shape is
 * loosely specified, so fields are optional + passthrough — the tool surfaces whatever
 * the API returns without over-constraining it.
 */
export const TopLperSchema = z
  .object({
    address: z.string().optional(),
    rank: z.number().optional(),
    avg_hold_hours: z.number().nullable().optional(),
    win_rate: z.number().nullable().optional(),
    preferred_strategy: z.string().nullable().optional(),
    total_positions: z.number().nullable().optional(),
    pnl_usd: z.number().nullable().optional(),
  })
  .passthrough();
export type TopLper = z.infer<typeof TopLperSchema>;

export const TopLpersResultSchema = z.object({
  lpers: z.array(TopLperSchema),
  count: z.number().int().nonnegative(),
});
export type TopLpersResult = z.infer<typeof TopLpersResultSchema>;

export const StudyResultSchema = z.object({
  lpers: z.array(TopLperSchema),
  summary: z.string().nullable(),
  patterns: z.array(z.string()),
});
export type StudyResult = z.infer<typeof StudyResultSchema>;
