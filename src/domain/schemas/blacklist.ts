import { z } from "zod";

export const BlacklistEntrySchema = z.object({
  symbol: z.string().nullable().optional(),
  reason: z.string(),
  added_at: z.string(),
  added_by: z.string().default("agent"),
});
export type BlacklistEntry = z.infer<typeof BlacklistEntrySchema>;

/** Mint → entry. Flat map, no wrapper object — matches token-blacklist.json shape. */
export const TokenBlacklistFileSchema = z.record(z.string(), BlacklistEntrySchema);
export type TokenBlacklistFile = z.infer<typeof TokenBlacklistFileSchema>;

export function emptyBlacklist(): TokenBlacklistFile {
  return {};
}
