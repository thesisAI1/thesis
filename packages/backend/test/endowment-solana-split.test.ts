/**
 * Wave 6 — the Endowment split, per chain.
 *
 * Base: author / lottery-or-team / buyback+burn $THESIS / portfolio (unchanged).
 * Solana: author (SOL) / team (SOL → SOLANA_BUYBACK_WALLET) / portfolio /
 * buyback-substitute (SOL → SOLANA_BUYBACK_WALLET). NO $THESIS burn, NO holder
 * lottery on Solana — even if the lottery is globally enabled.
 *
 * settlementPolicy is the pure decision (RED until it exists); the integration
 * test confirms a Solana settlement completes with the 25/25/25/25 accounting.
 */

import "./helpers/isolate-store.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "@thesis/shared";
import { runEndowment, settlementPolicy } from "../src/agents/endowment.js";

test("settlementPolicy: Solana uses no lottery and no $THESIS burn", () => {
  const p = settlementPolicy("solana");
  assert.equal(p.useLottery, false);
  assert.equal(p.useBurn, false);
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

test("Endowment: a Solana win settles 25/25/25/25 without burning $THESIS", async () => {
  const result = await runEndowment(solPosition(), 1, { silentAuthorTweet: true });
  assert.ok(result, "expected a distribution for a profitable Solana close");
  const d = result.distribution;
  assert.equal(d.toAuthorEth, 0.25);
  assert.equal(d.toPortfolioEth, 0.25);
  assert.equal(d.toTeamEth, 0.25, "team slice paid in SOL");
  assert.equal(d.toBuybackEth, 0.25, "buyback-substitute slice (SOL → wallet)");
  // No lottery on Solana even when globally enabled.
  assert.equal(result.lotteryPayment, null);
});
