/**
 * Solana wire ports. `SolanaConnection` gives read access to the chain (getBalance, etc);
 * `WalletKeypair` gives the sign-and-send side. Adapters wrap `@solana/web3.js`.
 *
 * We intentionally leak `unknown` here rather than pull in `Connection` / `Keypair` types.
 * Domain + app layers never touch the real SDK; only the Meteora adapter (which also lazy-
 * imports the CJS SDK) casts through these opaque handles.
 */
export interface SolanaConnection {
  /** RPC endpoint URL used by this connection. */
  endpoint: string;
  /** Native `Connection` from `@solana/web3.js` — opaque outside the chain adapter. */
  raw: unknown;
  /** Fetch native SOL balance (lamports) for an address. */
  getLamports(address: string): Promise<bigint>;
}

export interface WalletKeypair {
  /** Base58 public key. */
  address: string;
  /** Native `Keypair` from `@solana/web3.js` — opaque outside the chain adapter. */
  raw: unknown;
}
