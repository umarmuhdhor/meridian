export interface PriceOracle {
  /** Current SOL price in USD. Caching / retries up to the adapter. */
  getSolUsdPrice(): Promise<number>;
}
