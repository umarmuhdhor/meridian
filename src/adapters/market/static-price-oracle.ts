import type { PriceOracle } from "../../ports/price-oracle.js";

export function createStaticPriceOracle(usd: number): PriceOracle {
  return { async getSolUsdPrice() { return usd; } };
}
