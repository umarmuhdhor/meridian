export interface CandidateScoreInputs {
  fee_active_tvl_ratio?: number | null | undefined;
  fee_tvl_ratio?: number | null | undefined;
  organic_score?: number | null | undefined;
  volume_window?: number | null | undefined;
  holders?: number | null | undefined;
}

/**
 * Pure candidate score — mirrors tools/screening.js:35 scoreCandidate.
 *   score = fee_tvl * 1000 + organic * 10 + volume / 100 + holders / 100
 * Prefers `fee_active_tvl_ratio` if present, falls back to `fee_tvl_ratio`.
 */
export function scoreCandidate(pool: CandidateScoreInputs): number {
  const feeTvl = numberOrZero(pool.fee_active_tvl_ratio ?? pool.fee_tvl_ratio);
  const organic = numberOrZero(pool.organic_score);
  const volume = numberOrZero(pool.volume_window);
  const holders = numberOrZero(pool.holders);
  return feeTvl * 1000 + organic * 10 + volume / 100 + holders / 100;
}

function numberOrZero(v: number | null | undefined): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
