/**
 * Wave 6 — the Endowment split, per chain.
 *
 * Base: author / portfolio / buyback+burn $THESIS.
 * Solana: author (SOL) / portfolio / buyback-substitute (SOL →
 * SOLANA_BUYBACK_WALLET). NO $THESIS burn on Solana.
 *
 * settlementPolicy is the pure decision; the integration test confirms a Solana
 * settlement completes with the 25/50/25 accounting.
 */

import "./helpers/isolate-store.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "@thesis/shared";
import { runEndowment, settlementPolicy } from "../src/agents/endowment.js";

test("settlementPolicy: Solana uses no $THESIS burn", () => {
  assert.equal(settlementPolicy("solana").useBurn, false);
});

test("settlementPolicy: Base keeps the $THESIS burn", () => {
  assert.equal(settlementPolicy("base").useBurn, true);
});

function solPosition(): Position {
  return {
    id: "pos-sol-1",
    postId: "sol-1",
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
