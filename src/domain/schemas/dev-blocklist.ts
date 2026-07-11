import { z } from "zod";

/** Deployer-wallet blocklist entry — mirrors the JS dev-blocklist.js shape. */
export const DevBlocklistEntrySchema = z.object({
  label: z.string().nullable().optional(),
  reason: z.string(),
  added_at: z.string(),
  added_by: z.string().default("agent"),
});
export type DevBlocklistEntry = z.infer<typeof DevBlocklistEntrySchema>;

/** Wallet → entry. Flat map, no wrapper — matches dev-blocklist.json. */
export const DevBlocklistFileSchema = z.record(z.string(), DevBlocklistEntrySchema);
export type DevBlocklistFile = z.infer<typeof DevBlocklistFileSchema>;

export function emptyDevBlocklist(): DevBlocklistFile {
  return {};
}
