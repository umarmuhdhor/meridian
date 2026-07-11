import type { RugCheckResult } from "../domain/schemas/market.js";

export interface RugCheckClient {
  check(mint: string): Promise<RugCheckResult>;
}
