/**
 * Wave 6 — the Endowment split, per chain.
 *
 * Base: author / portfolio / buyback+burn $THESIS.
 * Solana: author (SOL) / portfolio / buyback-substitute (SOL →
 * SOLANA_BUYBACK_WALLET). NO $THESIS burn on Solana.
 *
 * settlementPolicy is the pure decision; the integration test confirms a Solana
 * settlement completes with the 25/50/25 accounting. Gap-1 additionally injects
 * a RecordingChain to pin that the buyback-substitute leg actually fires a SOL
 * send to SOLANA_BUYBACK_WALLET (mirrors the Base buyback coverage in
 * endowment-split.test.ts) — guarding against a regression that mis-routes the
 * recipient/amount or skips the send entirely.
 */

import "./helpers/isolate-store.js";
// SOLANA_BUYBACK_WALLET must be set BEFORE config.ts is evaluated. The src
// modules are dynamically imported (below) so this assignment lands first.
const SOL_BUYBACK_WALLET = "BuyBkW4LLeT1111111111111111111111111111111";
process.env.SOLANA_BUYBACK_WALLET = SOL_BUYBACK_WALLET;

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "@thesis/shared";

const { runEndowment, settlementPolicy } = await import("../src/agents/endowment.js");
const { __setChainForTest } = await import("../src/adapters/chain/index.js");
type ChainAdapter = import("../src/adapters/chain/index.js").ChainAdapter;
type SwapResult = import("../src/adapters/chain/index.js").SwapResult;

/** Records every SOL send so the buyback-substitute leg can be asserted. */
class RecordingChain implements ChainAdapter {
  readonly sends: { to: string; amountEth: number }[] = [];
  readonly buybacks: number[] = [];
  getWalletAddress(): string {
    return "So1anaWa11et1111111111111111111111111111111";
  }
  async getWalletBalanceEth(): Promise<number> {
    return 1.5;
  }
  async buy(_a: string, amountInEth: number): Promise<SwapResult> {
    return { txHash: "mockbuy", amountOut: amountInEth, priceEth: 1 };
  }
  async sell(): Promise<SwapResult> {
    return { txHash: "mocksell", amountOut: 0, priceEth: 1 };
  }
  async getTokenPriceEth(): Promise<number> {
    return 1;
  }
  async quoteSell(): Promise<{ proceedsEth: number }> {
    return { proceedsEth: 0 };
  }
  async sendEth(to: string, amountEth: number): Promise<string> {
    this.sends.push({ to, amountEth });
    return "mocksendsig";
  }
  async buybackAndBurn(amountInEth: number): Promise<{ txHash: string; tokensBurned: number }> {
    this.buybacks.push(amountInEth);
    return { txHash: "mockburn", tokensBurned: 1 };
  }
}

test("settlementPolicy: Solana uses no $THESIS burn", () => {
  assert.equal(settlementPolicy("solana").useBurn, false);
});

test("settlementPolicy: Base keeps the $THESIS burn", () => {
  assert.equal(settlementPolicy("base").useBurn, true);
});

function solPosition(id = "pos-sol-1"): Position {
  return {
    id,
    postId: `${id}-post`,
    authorXId: "777",
    authorHandle: "@sol_author",
    order: {
      contractAddress: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfpump",
      chain: "solana",
      amountInEth: 1,
      takeProfits: [{ priceX: 2, sellFraction: 0.5 }],
      stopLossX: 0.7,
    },
    status: "closed",
    entryPriceEth: 0.0000004,
    entryTxHash: "mocksig",
    remainingFraction: 0,
    tiersHit: 1,
    realisedPnlEth: 1,
    openedAt: new Date().toISOString(),
    closedAt: new Date().toISOString(),
    lastExitTxHash: "mockexitsig",
  };
}

test("Endowment: a Solana win settles 25/50/25 without burning $THESIS", async () => {
  const result = await runEndowment(solPosition(), 1, { silentAuthorTweet: true });
  assert.ok(result, "expected a distribution for a profitable Solana close");
  const d = result.distribution;
  assert.equal(d.toAuthorEth, 0.25);
  assert.equal(d.toPortfolioEth, 0.5);
  assert.equal(d.toBuybackEth, 0.25, "buyback-substitute slice (SOL → wallet)");
  assert.equal(
    d.toAuthorEth + d.toPortfolioEth + d.toBuybackEth,
    1,
    "the three legs must sum to the whole profit",
  );
});

// Gap-1 — the buyback-substitute leg must actually send the 25% quarter in SOL
// to SOLANA_BUYBACK_WALLET (and NOT route through buybackAndBurn, which is the
// Base $THESIS path). The author here has no wallet on file, so the only sendEth
// the settlement makes is the buyback leg — pin its recipient and amount.
test("Endowment: a Solana win sends the buyback quarter in SOL to SOLANA_BUYBACK_WALLET", async () => {
  const chain = new RecordingChain();
  __setChainForTest(chain);
  try {
    const result = await runEndowment(solPosition("pos-sol-buyback"), 1, { silentAuthorTweet: true });
    assert.ok(result, "expected a distribution for a profitable Solana close");
    assert.ok(
      chain.sends.some((s) => s.to === SOL_BUYBACK_WALLET && s.amountEth === 0.25),
      "the buyback-substitute quarter (0.25 SOL) must be sent to SOLANA_BUYBACK_WALLET",
    );
    assert.deepEqual(chain.buybacks, [], "Solana has no $THESIS to burn — buybackAndBurn must not run");
  } finally {
    __setChainForTest(null);
  }
});
