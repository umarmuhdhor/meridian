import type { SwapArgs, SwapResult } from "../domain/schemas/chain.js";

export interface SwapClient {
  swap(args: SwapArgs): Promise<SwapResult>;
}
