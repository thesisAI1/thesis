/**
 * Money-safety — take-profit tier sizing must use DELIVERED tokens.
 *
 * A tier must sell its intended fraction of the tokens the wallet ACTUALLY
 * received, not the larger count the market-mid entry price implies. For a
 * Doppler/Bankr token that delivered ~half the quote, sizing off
 * `amountInEth / entryPriceEth` oversells ~2× — which (clamped to the live
 * balance by chain.sell) liquidates almost the whole position on the first tier.
 *
 * Incident this pins — 2026-06-01 @GamerGuyz5 pos-2061177421601427598:
 *   router quoted 46.3M tokens for 0.020 ETH, wallet received 23.9M; a 50% first
 *   tier sized off the quote = 23.15M ≈ the FULL bag → ~97% liquidated.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "@thesis/shared";
import { tokensForCost, tokensRemaining } from "../src/domain/sizing.js";

const AMOUNT_IN = 0.02; // ETH spent on the entry buy
const QUOTED_TOKENS = 46_300_000; // router's optimistic forecast
const DELIVERED_TOKENS = 23_900_000; // what the wallet ACTUALLY received
const ENTRY_PRICE_MID = AMOUNT_IN / QUOTED_TOKENS; // market mid → implies the quote

function makePosition(entryTokens?: number): Position {
  return {
    id: "pos-sizing",
    postId: "pos-sizing-post",
    authorXId: "author-1",
    authorHandle: "@gamerguyz5",
    order: {
      contractAddress: "0xabcabcabcabcabcabcabcabcabcabcabcabcabca",
      chain: "base",
      amountInEth: AMOUNT_IN,
      takeProfits: [{ priceX: 2, sellFraction: 0.5 }],
      stopLossX: 0.7,
    },
    status: "open",
    entryPriceEth: ENTRY_PRICE_MID,
    entryTokens,
    entryTxHash: "0xentry",
    remainingFraction: 1,
    tiersHit: 0,
    realisedPnlEth: 0,
    openedAt: new Date().toISOString(),
  };
}

test("tier sell sizes off delivered entryTokens, not market-mid cost basis", () => {
  // TP1 sells 50% of the position → costEth = amountInEth × sellFraction.
  const costEth = AMOUNT_IN * 0.5;
  const tokens = tokensForCost(makePosition(DELIVERED_TOKENS), costEth);

  // Must be 50% of what we ACTUALLY hold (23.9M) ≈ 11.95M — NOT 50% of the
  // 46.3M the mid implies (23.15M, which clamps to ~97% of the bag).
  assert.ok(
    Math.abs(tokens - DELIVERED_TOKENS * 0.5) < 1,
    `expected ~${DELIVERED_TOKENS * 0.5} (50% of delivered) but got ${tokens} ` +
      `— sizing is still using the market-mid cost basis`,
  );
});

test("legacy position without entryTokens falls back to cost-basis sizing", () => {
  // Positions opened before entryTokens existed must keep the old behavior so
  // they still close — they just can't benefit from the delivery correction.
  const costEth = AMOUNT_IN * 0.5;
  const tokens = tokensForCost(makePosition(undefined), costEth);

  assert.ok(
    Math.abs(tokens - QUOTED_TOKENS * 0.5) < 1,
    `expected cost-basis fallback ~${QUOTED_TOKENS * 0.5} but got ${tokens}`,
  );
});

test("tokensRemaining returns the still-held slice of the delivered bag", () => {
  // The author close-gate and dashboard value the bag through this helper — it
  // must reflect the delivered tokens, not the ~2× market-mid estimate.
  const pos = makePosition(DELIVERED_TOKENS);
  pos.remainingFraction = 0.5; // first tier already sold half
  const tokens = tokensRemaining(pos);

  assert.ok(
    Math.abs(tokens - DELIVERED_TOKENS * 0.5) < 1,
    `expected ~${DELIVERED_TOKENS * 0.5} (half of delivered) but got ${tokens}`,
  );
});
