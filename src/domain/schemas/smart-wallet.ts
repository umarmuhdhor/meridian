import { z } from "zod";

export const SmartWalletSchema = z.object({
  name: z.string(),
  address: z.string(),
  category: z.string().optional(),
  type: z.enum(["lp", "holder"]).default("lp"),
  addedAt: z.string(),
});
export type SmartWallet = z.infer<typeof SmartWalletSchema>;

export const SmartWalletFileSchema = z.object({
  wallets: z.array(SmartWalletSchema).default([]),
});
export type SmartWalletFile = z.infer<typeof SmartWalletFileSchema>;

export function emptySmartWalletFile(): SmartWalletFile {
  return { wallets: [] };
}
