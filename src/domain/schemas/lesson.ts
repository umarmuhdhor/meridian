import { z } from "zod";

export const LessonSchema = z
  .object({
    id: z.string(),
    rule: z.string(),
    tags: z.array(z.string()).default([]),
    outcome: z.string().nullable().optional(),
    sourceType: z.string().nullable().optional(),
    confidence: z.number().nullable().optional(),
    role: z.string().nullable().optional(),
    pinned: z.boolean().default(false),
    context: z.record(z.string(), z.unknown()).nullable().optional(),
    created_at: z.string().optional(),
  })
  .passthrough();
export type Lesson = z.infer<typeof LessonSchema>;

export const PerformanceRecordSchema = z
  .object({
    position: z.string(),
    pool: z.string().optional(),
    pool_name: z.string().nullable().optional(),
    pnl_pct: z.number(),
    pnl_usd: z.number().optional(),
    fees_earned_usd: z.number().nonnegative().optional(),
    initial_value_usd: z.number().optional(),
    final_value_usd: z.number().optional(),
    range_efficiency: z.number().optional(),
    minutes_held: z.number().int().nonnegative().optional(),
    minutes_in_range: z.number().int().nonnegative().optional(),
    close_reason: z.string(),
    amount_sol: z.number().optional(),
    signal_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    recorded_at: z.string(),
  })
  .passthrough();
export type PerformanceRecord = z.infer<typeof PerformanceRecordSchema>;

export const LessonFileSchema = z.object({
  lessons: z.array(LessonSchema).default([]),
  performance: z.array(PerformanceRecordSchema).default([]),
});
export type LessonFile = z.infer<typeof LessonFileSchema>;

export function emptyLessonFile(): LessonFile {
  return { lessons: [], performance: [] };
}
