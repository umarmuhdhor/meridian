import type {
  TokenHoldersSummary,
  TokenInfo,
  TokenNarrative,
} from "../domain/schemas/market.js";

export interface TokenInfoClient {
  getInfo(mint: string): Promise<TokenInfo>;
  getHolders(mint: string, limit?: number): Promise<TokenHoldersSummary>;
  getNarrative(mint: string): Promise<TokenNarrative>;
}
