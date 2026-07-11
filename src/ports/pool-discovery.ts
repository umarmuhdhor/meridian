import type { CandidatePool } from "../domain/schemas/market.js";

export interface DiscoverOptions {
  limit?: number;
  timeframe?: string;
  category?: string;
}

export interface PoolDiscoveryClient {
  /** Return raw candidate pools from the source (Meteora, Agent Meridian, etc). */
  discover(opts?: DiscoverOptions): Promise<CandidatePool[]>;
  /** Free-text search — for the `search_pools` tool. */
  search(query: string, limit?: number): Promise<CandidatePool[]>;
  /** Single pool lookup by address — for the deploy safety fresh-fetch. */
  getPoolDetail(poolAddress: string): Promise<CandidatePool | null>;
}
