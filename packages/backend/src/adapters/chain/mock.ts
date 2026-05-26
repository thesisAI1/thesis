import { seed } from "../../util/seed.js";
import type { ChainAdapter, SwapResult } from "./index.js";

/**
 * Simulated chain — fills trades instantly, no real funds.
 *
 * Each token gets its own seeded starting price. On every price read the
 * price drifts: most tokens trend up (towards take-profit), some trend down
 * (towards stop-loss) — so the demo produces a realistic mix of wins/losses.
 */
const prices = new Map<string, number>();

function priceOf(address: string): number {
  let p = prices.get(address);
  if (p === undefined) {
    p = 0.0000002 + seed(address, "price") * 0.0000018;
    prices.set(address, p);
  }
  return p;
}

export class MockChain implements ChainAdapter {
  getWalletAddress(): string {
    return "0x7a5e9c0d4b3a2f1e8d7c6b5a4938271605f4e3d2";
  }

  async getWalletBalanceEth(): Promise<number> {
    return 1.5; // fixed mock portfolio
  }

  async buy(address: string, amountInEth: number): Promise<SwapResult> {
    const price = priceOf(address);
    return { txHash: "0xMOCKbuytx", amountOut: amountInEth / price, priceEth: price };
  }

  async sell(address: string, amountTokens: number): Promise<SwapResult> {
    const price = priceOf(address);
    return { txHash: "0xMOCKselltx", amountOut: amountTokens * price, priceEth: price };
  }

  async getTokenPriceEth(address: string): Promise<number> {
    const current = priceOf(address);
    const trendsUp = seed(address, "trend") > 0.3;
    prices.set(address, current * (trendsUp ? 1.4 : 0.93));
    return current;
  }

  async sendEth(_toAddress: string, _amountEth: number): Promise<string> {
    return "0xMOCKsendtx";
  }

  async buybackAndBurn(amountInEth: number): Promise<{ txHash: string; tokensBurned: number }> {
    return { txHash: "0xMOCKburntx", tokensBurned: amountInEth / 0.0000004 };
  }
}
