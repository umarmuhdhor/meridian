import { z } from "zod";
import { TrackedPositionSchema } from "./position.js";

export const RecentEventSchema = z.object({
  ts: z.string(),
  action: z.string(),
  position: z.string().optional(),
  pool_name: z.string().optional(),
  reason: z.string().optional(),
});
export type RecentEvent = z.infer<typeof RecentEventSchema>;

export const StateFileSchema = z.object({
  positions: z.record(z.string(), TrackedPositionSchema).default({}),
  recentEvents: z.array(RecentEventSchema).default([]),
  lastUpdated: z.string().nullable().default(null),
  _lastBriefingDate: z.string().optional(),
});
export type StateFile = z.infer<typeof StateFileSchema>;

export function emptyState(): StateFile {
  return {
    positions: {},
    recentEvents: [],
    lastUpdated: null,
  };
}
