import type { Clock } from "../../ports/clock.js";
import type { ChainClient, GetPositionsOptions } from "../../ports/chain-client.js";
import type {
  ActiveBin,
  ClaimResult,
  CloseResult,
  DeployArgs,
  DeployResult,
  OnChainPosition,
  PositionsSnapshot,
  WalletBalance,
} from "../../domain/schemas/chain.js";
import { createTtlCache } from "../../shared/cache.js";

export interface DryRunSeed {
  /** Seed wallet in SOL. Deploys decrement it. */
  walletSol?: number;
  solPriceUsd?: number;
  /** Pre-existing open positions. Managed by close/deploy. */
  positions?: OnChainPosition[];
  /** Active bin per pool. */
  activeBins?: Record<string, ActiveBin>;
  /** Wallet address surfaced in balance response. */
  wallet?: string;
}

export interface DryRunChainClient extends ChainClient {
  /** Test hook: replace the whole world (bin, positions, wallet). */
  setState(next: Partial<DryRunSeed>): void;
  /** Test hook: peek at the current in-memory position list. */
  peekPositions(): OnChainPosition[];
}

export interface DryRunOptions {
  clock: Clock;
  positionsTtlMs?: number;
  seed?: DryRunSeed;
}

const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_SOL_PRICE = 150;

/**
 * Fully-deterministic ChainClient — no network. Enables agent-loop tests
 * and DRY_RUN daemon boots without touching the Meteora SDK.
 *
 * Preserves the semantics that matter for correctness:
 * - `getMyPositions({force: true})` bypasses cache (deploy safety needs a fresh count).
 * - Inflight dedup: concurrent callers share one fetch.
 * - Deploy/close/claim mutate the in-memory position list atomically.
 * - Every write result carries `dry_run: true` and a fake `tx: "dry-run-…"` id.
 */
export function createDryRunChainClient(opts: DryRunOptions): DryRunChainClient {
  const clock = opts.clock;
  let walletSol = opts.seed?.walletSol ?? 10;
  const solPriceUsd = opts.seed?.solPriceUsd ?? DEFAULT_SOL_PRICE;
  let positions: OnChainPosition[] = [...(opts.seed?.positions ?? [])];
  let activeBins: Record<string, ActiveBin> = { ...(opts.seed?.activeBins ?? {}) };
  const wallet = opts.seed?.wallet ?? "DryRunWallet11111111111111111111111111111111";

  let deployCounter = 0;
  let txCounter = 0;
  const nextTx = (): string => `dry-run-tx-${++txCounter}`;
  const nextPositionAddress = (): string => `dry-run-pos-${++deployCounter}`;

  const positionsCache = createTtlCache<PositionsSnapshot>({
    ttlMs: opts.positionsTtlMs ?? DEFAULT_TTL_MS,
    clock,
  });

  const buildSnapshot = (): PositionsSnapshot => ({
    total_positions: positions.length,
    positions: positions.map((p) => ({ ...p })),
    wallet,
    fetched_at: clock.now().toISOString(),
  });

  const findPosition = (address: string): number => positions.findIndex((p) => p.position === address);

  return {
    async getWalletBalance(_walletAddress?: string): Promise<WalletBalance> {
      return {
        sol: round(walletSol, 4),
        sol_usd: round(walletSol * solPriceUsd, 2),
        sol_price: solPriceUsd,
        fetched_at: clock.now().toISOString(),
      };
    },

    async getActiveBin(poolAddress: string): Promise<ActiveBin> {
      const bin = activeBins[poolAddress];
      if (bin) return bin;
      return { binId: 8388608, price: 1, pricePerLamport: "1" };
    },

    async getMyPositions(o: GetPositionsOptions = {}): Promise<PositionsSnapshot> {
      return positionsCache.get(async () => buildSnapshot(), o.force ?? false);
    },

    async deployPosition(args: DeployArgs): Promise<DeployResult> {
      const active = (await this.getActiveBin(args.pool_address)).binId;
      const lowerBin = active - args.bins_below;
      const upperBin = active + (args.bins_above ?? 0);
      const positionAddress = nextPositionAddress();
      const position: OnChainPosition = {
        position: positionAddress,
        pool: args.pool_address,
        pair: args.pool_name ?? "DRY/SOL",
        base_mint: null,
        lower_bin: lowerBin,
        upper_bin: upperBin,
        active_bin: active,
        in_range: true,
        unclaimed_fees_usd: 0,
        pnl_pct: 0,
        pnl_pct_suspicious: false,
        total_value_usd: args.amount_sol * solPriceUsd,
        fee_per_tvl_24h: null,
        age_minutes: 0,
        strategy: args.strategy,
        ...(args.bin_step !== undefined ? { bin_step: args.bin_step } : {}),
        amount_sol: args.amount_sol,
        deployed_at: clock.now().toISOString(),
      };
      positions.push(position);
      walletSol = Math.max(0, walletSol - args.amount_sol);
      positionsCache.invalidate();
      return {
        success: true,
        position_address: positionAddress,
        pool_address: args.pool_address,
        strategy: args.strategy,
        lower_bin: lowerBin,
        upper_bin: upperBin,
        active_bin: active,
        amount_sol: args.amount_sol,
        tx: nextTx(),
        dry_run: true,
        ...(args.bin_step !== undefined ? { bin_step: args.bin_step } : {}),
      };
    },

    async closePosition(positionAddress: string, reason: string): Promise<CloseResult> {
      const idx = findPosition(positionAddress);
      if (idx === -1) {
        return {
          success: false,
          position_address: positionAddress,
          pool_address: "",
          base_mint: null,
          final_pnl_pct: null,
          final_value_usd: null,
          fees_earned_usd: 0,
          reason: `unknown position: ${positionAddress}`,
          tx: null,
          dry_run: true,
        };
      }
      const [removed] = positions.splice(idx, 1);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const pos = removed!;
      const value = pos.total_value_usd ?? 0;
      walletSol += (pos.amount_sol ?? 0) * (1 + (pos.pnl_pct ?? 0) / 100);
      positionsCache.invalidate();
      return {
        success: true,
        position_address: positionAddress,
        pool_address: pos.pool,
        base_mint: pos.base_mint,
        final_pnl_pct: pos.pnl_pct,
        final_value_usd: value,
        fees_earned_usd: pos.unclaimed_fees_usd,
        reason,
        tx: nextTx(),
        dry_run: true,
      };
    },

    async claimFees(positionAddress: string): Promise<ClaimResult> {
      const idx = findPosition(positionAddress);
      if (idx === -1) {
        return {
          success: false,
          position_address: positionAddress,
          claimed_usd: 0,
          tx: null,
          dry_run: true,
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const pos = positions[idx]!;
      const claimed = pos.unclaimed_fees_usd;
      positions[idx] = { ...pos, unclaimed_fees_usd: 0 };
      positionsCache.invalidate();
      return {
        success: true,
        position_address: positionAddress,
        claimed_usd: claimed,
        tx: nextTx(),
        dry_run: true,
      };
    },

    setState(next: Partial<DryRunSeed>): void {
      if (next.walletSol !== undefined) walletSol = next.walletSol;
      if (next.positions !== undefined) positions = [...next.positions];
      if (next.activeBins !== undefined) activeBins = { ...next.activeBins };
      positionsCache.invalidate();
    },

    peekPositions(): OnChainPosition[] {
      return positions.map((p) => ({ ...p }));
    },
  };
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
