import type { TokenInfoClient } from "../../ports/token-info-client.js";
import type {
  TokenHoldersSummary,
  TokenInfo,
  TokenNarrative,
} from "../../domain/schemas/market.js";

export interface FakeTokenInfoOptions {
  info?: Record<string, TokenInfo>;
  holders?: Record<string, TokenHoldersSummary>;
  narrative?: Record<string, TokenNarrative>;
}

/** In-memory token info source. Missing mints get sane empty defaults. */
export function createFakeTokenInfo(opts: FakeTokenInfoOptions = {}): TokenInfoClient {
  const info = { ...(opts.info ?? {}) };
  const holders = { ...(opts.holders ?? {}) };
  const narrative = { ...(opts.narrative ?? {}) };

  return {
    async getInfo(mint: string): Promise<TokenInfo> {
      return (
        info[mint] ?? {
          mint,
          symbol: null,
          name: null,
          launchpad: null,
          deployer: null,
          supply: null,
          mcap: null,
          holders: null,
          age_hours: null,
        }
      );
    },
    async getHolders(mint: string): Promise<TokenHoldersSummary> {
      return (
        holders[mint] ?? {
          mint,
          count: 0,
          top10_pct: 0,
          bot_pct: 0,
          top: [],
        }
      );
    },
    async getNarrative(mint: string): Promise<TokenNarrative> {
      return narrative[mint] ?? { mint, narrative: null, tags: [] };
    },
  };
}
