/**
 * Adapter: the trading chain — the Bursar's hands (wallet + swaps). Selected
 * per position by `createChainAdapter(chain)`:
 *
 *   Base  — MockChain (./mock.ts) | RealChain (./real.ts, viem + KyberSwap)
 *   Solana — MockSolanaChain (./solana.mock.ts) | RealSolanaChain
 *            (./solana.real.ts, @solana/web3.js + Jupiter)
 *
 * The `*Eth` fields throughout the interface carry NATIVE units scoped to the
 * adapter's chain — ETH on Base, SOL on Solana. The pipeline treats a position's
 * value in its own native unit (see util/chains.ts for symbol/explorer).
 */

import type { Chain } from "@thesis/shared";
import { useMock } from "../../config.js";
import { MockChain } from "./mock.js";
import { RealChain } from "./real.js";
import { MockSolanaChain } from "./solana.mock.js";
import { RealSolanaChain } from "./solana.real.js";

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
  /** Sell `amountTokens` of a token back to ETH.
   *
   *  `opts.maxAttempts` (default 1) and `opts.delayBetweenMs` (default 0)
   *  control resilience against transient on-chain reverts. When `maxAttempts
   *  > 1`, the implementation should retry ON `TRANSFER_FROM_FAILED` only
   *  (the most common failure mode for Clanker v4 anti-MEV / transfer-tax
   *  tokens), with each retry tightening the balance clamp and asking the
   *  aggregator to avoid the DEX that just failed. Use this from the manual-
   *  close path where the author has explicitly asked us to keep trying;
   *  automatic TP/SL paths should leave it at the default and let the next
   *  monitor tick re-attempt. */
  sell(
    address: string,
    amountTokens: number,
    opts?: { maxAttempts?: number; delayBetweenMs?: number },
  ): Promise<SwapResult>;
  /** Spot price in ETH per token. */
  getTokenPriceEth(address: string): Promise<number>;
  /** Real-time on-chain quote: what ETH amount would we actually receive
   *  if we sold `amountTokens` right now via the aggregator?
   *
   *  Critical for money-relevant decisions (manual close gate, force-close
   *  endpoint) where a stale Birdeye cache could approve a close at the
   *  wrong profit level — see the 2026-05-30 JustT1602 incident where the
   *  gate saw +40% profit from a cached price but the actual sell landed
   *  at +12%. KyberSwap's route endpoint returns the exact post-routing
   *  amountOut for a given input, with no caching layer between us and
   *  the live LP state, so the gate's math matches what the sell will
   *  actually fill at (modulo a few seconds of normal market drift).
   *
   *  Costs nothing — KyberSwap aggregator is a free public endpoint and
   *  we already use it for every buy/sell. */
  quoteSell(address: string, amountTokens: number): Promise<{ proceedsEth: number }>;
  /** Send ETH to an address — author and team payouts. Returns the tx hash. */
  sendEth(toAddress: string, amountEth: number): Promise<string>;
  /** Buy $THESIS with `amountInEth` and send it straight to the burn address. */
  buybackAndBurn(amountInEth: number): Promise<{ txHash: string; tokensBurned: number }>;
}

let _testOverride: ChainAdapter | null = null;

/** TEST ONLY — force a specific chain adapter (e.g. one that simulates a failing
 *  send) so settlement-retry behaviour can be exercised deterministically.
 *  Throws in production so it can never be used to hijack the live wallet. Pass
 *  null to clear the override. */
export function __setChainForTest(adapter: ChainAdapter | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("__setChainForTest is not available in production");
  }
  _testOverride = adapter;
}

/**
 * Build the chain adapter for `chain`. Defaults to "base" so every existing
 * arg-less caller is unchanged. Solana → the Jupiter/web3.js adapter; every
 * other (EVM) chain → the existing Base adapter.
 */
export function createChainAdapter(chain: Chain = "base"): ChainAdapter {
  if (_testOverride) return _testOverride;
  if (chain === "solana") {
    return useMock() ? new MockSolanaChain() : new RealSolanaChain();
  }
  return useMock() ? new MockChain() : new RealChain();
}
