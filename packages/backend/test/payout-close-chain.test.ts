/**
 * Money-safety — a Solana win's author-payout REQUEST must be bound to the
 * Solana chain, so the bot asks for a base58 SOL wallet and the author's reply
 * is accepted + paid in SOL.
 *
 * Incident this pins — 2026-06-05 @JustT1602 (Solana win, +0.1227 SOL):
 *   the position was manually closed in profit and the author had no wallet on
 *   file, so we escrowed and posted a payout request. But the close path stored
 *   the PayoutRequest WITHOUT a chain, so it defaulted to "base": the reply text
 *   asked for a "Base wallet (0x…)" and, when the author answered with their
 *   valid base58 Solana wallet, the wallet-reply matcher (validating against the
 *   defaulted "base" chain) rejected it as wrong-shape. The author was never paid.
 *
 * Defence pinned here: a Solana manual close stores the PayoutRequest with
 * chain "solana", so the downstream base58 reply is honoured (that half is
 * already covered by payout-solana.test.ts — this test pins the producer side).
 */

import "./helpers/isolate-store.js"; // temp DATA_DIR + mock mode before config loads
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "@thesis/shared";
import { createBaseDataAdapter } from "../src/adapters/basedata/index.js";
import { getStore } from "../src/store/index.js";
import { processAuthorCloseRequests } from "../src/pipeline/author-actions.js";
import type { XPost } from "../src/adapters/x/index.js";

const SOL_MINT = "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfpump";

function solanaPosition(opts: { entryPriceEth: number }): Position {
  return {
    id: "pos-sol-close",
    postId: "thesis-sol-close",
    authorXId: "justt1602",
    authorHandle: "@JustT1602",
    postUrl: "https://x.com/JustT1602/status/thesis-sol-close",
    order: {
      contractAddress: SOL_MINT,
      chain: "solana",
      amountInEth: 0.1,
      takeProfits: [{ priceX: 5, sellFraction: 1 }], // far away — monitor won't auto-close
      stopLossX: 0.5,
    },
    status: "open",
    entryPriceEth: opts.entryPriceEth,
    entryTokens: 1_000_000,
    entryTxHash: "entrysig",
    remainingFraction: 1,
    tiersHit: 0,
    realisedPnlEth: 0,
    openedAt: new Date().toISOString(),
  };
}

function closeReply(): XPost {
  return {
    postId: "sol-close-reply",
    authorXId: "justt1602",
    authorHandle: "@JustT1602",
    text: "close it",
    createdAt: new Date().toISOString(),
    url: "https://x.com/JustT1602/status/sol-close-reply",
    authorFollowers: 100,
    engagement: 1,
    inReplyToId: "thesis-sol-close",
  };
}

test("Solana manual close binds the author payout request to chain 'solana'", async () => {
  const store = getStore();
  const price = await createBaseDataAdapter("solana").getPriceEth(SOL_MINT);
  // Current price is 3× entry → well above the +20% manual-close threshold, and
  // the author has no wallet on file → settlement escrows and posts a request.
  const pos = solanaPosition({ entryPriceEth: price / 3 });
  await store.savePosition(pos);

  await processAuthorCloseRequests([closeReply()]);

  const closed = (await store.getAllPositions()).find((p) => p.id === pos.id);
  assert.equal(closed?.status, "closed", "the author close well above +20% must execute");

  const requests = (await store.getPayoutRequests()).filter((r) => r.xUserId === "justt1602");
  assert.ok(requests.length >= 1, "an escrowed Solana win must post a payout request");
  assert.ok(
    requests.every((r) => r.chain === "solana"),
    `the payout request must be bound to chain 'solana' (got ${JSON.stringify(requests.map((r) => r.chain))}) ` +
      "— a base default makes the bot ask for a 0x wallet and reject the author's base58 reply",
  );
});
