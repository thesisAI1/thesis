/**
 * Adapter: the Base chain itself — the Bursar's hands (wallet + swaps).
 *
 *   - MockChain  (./mock.ts)  — simulated trades, no real funds, $0
 *   - RealChain  (./real.ts)  — viem on Base (test on Sepolia first)
 */

import { useMock } from "../../config.js";
import { MockChain } from "./mock.js";
import { RealChain } from "./real.js";

/** Result of a swap. */
export interface SwapResult {
  txHash: string;
  /** Tokens received (buy) or ETH received (sell). */
  amountOut: number;
  /** Execution price in ETH per token. */
  priceEth: number;
}

export interface ChainAdapter {
  /** The trading wallet's address (for on-chain transparency links). */
  getWalletAddress(): string;
  /** Trading wallet ETH balance — the portfolio size. */
  getWalletBalanceEth(): Promise<number>;
  /** Buy `amountInEth` worth of a token. */
  buy(address: string, amountInEth: number): Promise<SwapResult>;
  /** Sell `amountTokens` of a token back to ETH. */
  sell(address: string, amountTokens: number): Promise<SwapResult>;
  /** Spot price in ETH per token. */
  getTokenPriceEth(address: string): Promise<number>;
  /** Send ETH to an address — author and team payouts. Returns the tx hash. */
  sendEth(toAddress: string, amountEth: number): Promise<string>;
  /** Buy $THESIS with `amountInEth` and send it straight to the burn address. */
  buybackAndBurn(amountInEth: number): Promise<{ txHash: string; tokensBurned: number }>;
}

export function createChainAdapter(): ChainAdapter {
  return useMock() ? new MockChain() : new RealChain();
}
