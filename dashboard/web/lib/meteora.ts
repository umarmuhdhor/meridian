// Deep link to a pool on Meteora, e.g.
// https://www.meteora.ag/dlmm/2CVnAQY...?referrer=portfolio
export function meteoraPoolUrl(pool: string): string {
  return `https://www.meteora.ag/dlmm/${pool}?referrer=portfolio`;
}
