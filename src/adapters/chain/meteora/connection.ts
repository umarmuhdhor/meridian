import type { SolanaConnection, WalletKeypair } from "../../../ports/solana.js";

const LAMPORTS_PER_SOL_BI = 1_000_000_000n;

/**
 * Build a live Solana connection + wallet from env-derived inputs.
 * `@solana/web3.js` is dynamic-imported so this module can be loaded even in DRY_RUN
 * boots that never touch the chain.
 */
export async function createSolanaConnection(endpoint: string): Promise<SolanaConnection> {
  const web3 = await import("@solana/web3.js");
  const conn = new web3.Connection(endpoint, "confirmed");
  return {
    endpoint,
    raw: conn,
    async getLamports(address: string): Promise<bigint> {
      const pk = new web3.PublicKey(address);
      const lamports = await conn.getBalance(pk, "confirmed");
      return BigInt(lamports);
    },
  };
}

/**
 * Load a wallet from a base58 secret key OR a JSON array (both formats seen in the wild).
 * Never logs the key. Throws with a redacted message on parse failure.
 */
export async function loadWalletKeypair(secret: string): Promise<WalletKeypair> {
  const web3 = await import("@solana/web3.js");
  const bs58 = await import("bs58");
  const trimmed = secret.trim();

  let keypair: InstanceType<typeof web3.Keypair>;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("wallet secret: JSON array parse failed");
    }
    if (!Array.isArray(parsed)) throw new Error("wallet secret: JSON not an array");
    keypair = web3.Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
  } else {
    let bytes: Uint8Array;
    try {
      const decoder: unknown = (bs58 as unknown as { default?: { decode: (s: string) => Uint8Array } }).default ?? bs58;
      bytes = (decoder as { decode: (s: string) => Uint8Array }).decode(trimmed);
    } catch {
      throw new Error("wallet secret: base58 decode failed");
    }
    keypair = web3.Keypair.fromSecretKey(bytes);
  }
  return {
    address: keypair.publicKey.toBase58(),
    raw: keypair,
  };
}

export function lamportsToSol(lamports: bigint): number {
  // Preserves 4-decimal SOL precision without hitting Number-precision loss on huge balances.
  const whole = Number(lamports / LAMPORTS_PER_SOL_BI);
  const frac = Number(lamports % LAMPORTS_PER_SOL_BI) / Number(LAMPORTS_PER_SOL_BI);
  return whole + frac;
}
