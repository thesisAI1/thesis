import { seed } from "../../util/seed.js";
import type { ChainAdapter, SwapResult } from "./index.js";

/**
 * Simulated Solana chain — the MockChain analogue for Solana positions.
 *
 * Fills trades instantly, no real funds. Native unit is SOL, so the `*Eth`
 * fields here carry SOL (the pipeline treats `*Eth` as native-per-chain). Each
 * mint gets its own seeded starting price that drifts up or down on every read,
 * exactly like MockChain, so the demo produces a realistic mix of Solana
 * wins/losses alongside Base.
 */

/** Bitcoin/Solana base58 alphabet (no 0 O I l). */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Deterministic base58 string of `len` chars from a seed — shaped like a real
 *  Solana address (44) or signature (88). */
function b58(seedNum: number, len: number): string {
  let x = (seedNum >>> 0) || 1;
  let out = "";
  for (let i = 0; i < len; i++) {
    x = (Math.imul(x, 1_664_525) + 1_013_904_223) >>> 0;
    out += B58[x % 58];
  }
  return out;
}

const prices = new Map<string, number>();

/** Seeded SOL-per-token price — memecoin scale, same magnitude as MockChain. */
function priceOf(mint: string): number {
  let p = prices.get(mint);
  if (p === undefined) {
    p = 0.0000002 + seed(mint, "price") * 0.0000018;
    prices.set(mint, p);
  }
  return p;
}

export class MockSolanaChain implements ChainAdapter {
  getWalletAddress(): string {
    // Stable, valid-shaped base58 mock wallet (44 chars).
    return b58(0x50_1a_4a, 44);
  }

  async getWalletBalanceEth(): Promise<number> {
    return 12; // fixed mock SOL portfolio
  }

  async buy(mint: string, amountInEth: number): Promise<SwapResult> {
    const price = priceOf(mint);
    return { txHash: b58(hash(mint + "buy"), 64), amountOut: amountInEth / price, priceEth: price };
  }

  async sell(
    mint: string,
    amountTokens: number,
    _opts?: { maxAttempts?: number; delayBetweenMs?: number },
  ): Promise<SwapResult> {
    const price = priceOf(mint);
    return { txHash: b58(hash(mint + "sell"), 64), amountOut: amountTokens * price, priceEth: price };
  }

  async getTokenPriceEth(mint: string): Promise<number> {
    const current = priceOf(mint);
    const trendsUp = seed(mint, "trend") > 0.3;
    prices.set(mint, current * (trendsUp ? 1.4 : 0.93));
    return current;
  }

  async quoteSell(mint: string, amountTokens: number): Promise<{ proceedsEth: number }> {
    return { proceedsEth: amountTokens * priceOf(mint) };
  }

  async sendEth(_toAddress: string, _amountEth: number): Promise<string> {
    return b58(hash("send"), 64);
  }

  /** No $THESIS exists on Solana to burn — the Endowment routes the Solana
   *  buyback slice to SOLANA_BUYBACK_WALLET via sendEth instead, so this is
   *  never called for a Solana position. Implemented as a benign mock to
   *  satisfy the interface (and keep the demo crash-free if it ever is). */
  async buybackAndBurn(amountInEth: number): Promise<{ txHash: string; tokensBurned: number }> {
    return { txHash: b58(hash("burn"), 64), tokensBurned: amountInEth / 0.0000004 };
  }
}

/** Small 32-bit string hash for deterministic, distinct mock signatures. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h;
}
