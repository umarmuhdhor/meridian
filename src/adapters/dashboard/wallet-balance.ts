// Assemble the web-shaped wallet balance ({sol, sol_usd, sol_price, usdc, tokens[],
// total_usd}) from the chain client. getWalletTokens is optional on ChainClient — when
// the adapter can't enumerate SPL tokens (e.g. dry-run), tokens is [] and total_usd
// falls back to the SOL value, so the wallet page still renders.

import type { ChainClient } from "../../ports/chain-client.js";
import type { WalletToken } from "../../domain/schemas/chain.js";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export interface WebWalletBalance {
  sol: number;
  sol_usd: number;
  sol_price: number;
  usdc: number;
  tokens: WalletToken[];
  total_usd: number;
}

export async function assembleWalletBalance(chain: ChainClient): Promise<WebWalletBalance> {
  const bal = await chain.getWalletBalance();
  const tokens = chain.getWalletTokens
    ? await chain.getWalletTokens().catch(() => [] as WalletToken[])
    : [];
  const tokenUsd = tokens.reduce((s, t) => s + (t.usd ?? 0), 0);
  const usdc = tokens.find((t) => t.mint === USDC_MINT)?.balance ?? 0;
  return {
    sol: bal.sol,
    sol_usd: bal.sol_usd,
    sol_price: bal.sol_price,
    usdc,
    tokens,
    total_usd: Math.round((bal.sol_usd + tokenUsd) * 100) / 100,
  };
}
