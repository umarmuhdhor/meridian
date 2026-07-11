import type { PoolDiscoveryClient, DiscoverOptions } from "../../ports/pool-discovery.js";
import type { CandidatePool } from "../../domain/schemas/market.js";

export interface FakePoolDiscoveryOptions {
  seed: CandidatePool[];
}

/** Deterministic pool source — search is a case-insensitive substring on name. */
export function createFakePoolDiscovery(opts: FakePoolDiscoveryOptions): PoolDiscoveryClient {
  const pools: CandidatePool[] = [...opts.seed];
  return {
    async discover(o: DiscoverOptions = {}) {
      const limit = o.limit ?? 10;
      return pools.slice(0, limit).map((p) => ({ ...p }));
    },
    async search(query: string, limit = 10) {
      const q = query.toLowerCase();
      return pools
        .filter((p) => p.name.toLowerCase().includes(q) || p.pool_address.toLowerCase().includes(q))
        .slice(0, limit)
        .map((p) => ({ ...p }));
    },
    async getPoolDetail(poolAddress: string) {
      const hit = pools.find((p) => p.pool_address === poolAddress);
      return hit ? { ...hit } : null;
    },
  };
}
