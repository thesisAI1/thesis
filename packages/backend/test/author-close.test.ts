/**
 * Tier A — author manual-close gating (pipeline/author-actions.ts).
 *
 * An author can close their OWN winning position early by replying to their
 * thesis tweet with a short close command. Three guards protect real ETH exits,
 * and all three were previously untested:
 *   1. anti-hijack — only the original author (numeric X id) may close;
 *   2. intent regex — a short (≤5-word) close command, no negation, no prose;
 *   3. +20% threshold — refuse to close at a loss (don't let an author dump
 *      right before slippage to dodge the standard stop-loss).
 *
 * The pure regex is unit-tested directly; the anti-hijack + threshold are tested
 * end-to-end through processAuthorCloseRequests against the mock store/price.
 */

import "./helpers/isolate-store.js"; // temp DATA_DIR + mock mode before config loads
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "@thesis/shared";
import { config } from "../src/config.js";
import { createBaseDataAdapter } from "../src/adapters/basedata/index.js";
import { getStore } from "../src/store/index.js";
import { isCloseRequest, processAuthorCloseRequests } from "../src/pipeline/author-actions.js";
import type { XPost } from "../src/adapters/x/index.js";

// --- the intent regex as a pure unit -----------------------------------------

test("isCloseRequest accepts short close commands", () => {
  for (const t of ["close", "close it", "close position", "close the position", "tp now", "take profit", "dump now", "sell all", "@thesisbot close it"]) {
    assert.equal(isCloseRequest(t), true, `should accept: "${t}"`);
  }
});

test("isCloseRequest rejects prose, negations, and non-commands", () => {
  for (const t of [
    "I might close this thing eventually maybe", // too many words
    "don't close",                               // negated
    "do not sell",                               // negated
    "I'm not going to close",                    // negated
    "great thesis, thanks!",                     // no keyword
    "",                                          // empty
  ]) {
    assert.equal(isCloseRequest(t), false, `should reject: "${t}"`);
  }
});

// --- integration: anti-hijack + profit threshold -----------------------------

function openPosition(opts: {
  id: string;
  postId: string;
  authorXId: string;
  contract: string;
  entryPriceEth: number;
}): Position {
  return {
    id: opts.id,
    postId: opts.postId,
    authorXId: opts.authorXId,
    authorHandle: "@author",
    postUrl: `https://x.com/author/status/${opts.postId}`,
    order: {
      contractAddress: opts.contract,
      chain: "base",
      amountInEth: 0.1,
      takeProfits: [{ priceX: 5, sellFraction: 1 }], // far away — monitor won't auto-close
      stopLossX: 0.5,
    },
    status: "open",
    entryPriceEth: opts.entryPriceEth,
    entryTxHash: "0xentry",
    remainingFraction: 1,
    tiersHit: 0,
    realisedPnlEth: 0,
    openedAt: new Date().toISOString(),
  };
}

function closeReply(opts: { authorXId: string; inReplyToId: string; text: string; postId: string }): XPost {
  return {
    postId: opts.postId,
    authorXId: opts.authorXId,
    authorHandle: "@whoever",
    text: opts.text,
    createdAt: new Date().toISOString(),
    url: `https://x.com/x/status/${opts.postId}`,
    authorFollowers: 10,
    engagement: 0,
    inReplyToId: opts.inReplyToId,
  };
}

test("author-close: a non-author 'close' reply is ignored (position stays open, passes through)", async () => {
  const store = getStore();
  const contract = "0xc105e0000000000000000000000000000000aa01";
  const price = await createBaseDataAdapter().getPriceEth(contract);
  const pos = openPosition({
    id: "pos-hijack",
    postId: "thesis-hijack",
    authorXId: "real-author-1",
    contract,
    entryPriceEth: price / 3, // deep in profit, so ONLY the hijack guard can stop it
  });
  await store.savePosition(pos);

  const passthrough = await processAuthorCloseRequests([
    closeReply({ authorXId: "imposter-9", inReplyToId: "thesis-hijack", text: "close it", postId: "hijack-reply" }),
  ]);

  const fresh = (await store.getAllPositions()).find((p) => p.id === "pos-hijack");
  assert.equal(fresh?.status, "open", "an imposter must NOT be able to close someone else's position");
  assert.equal(passthrough.length, 1, "the non-author reply passes through (it may be a normal mention)");
});

test("author-close: the author's close BELOW +20% is rejected (position stays open)", async () => {
  const store = getStore();
  const contract = "0xc105e0000000000000000000000000000000aa02";
  const price = await createBaseDataAdapter().getPriceEth(contract);
  const pos = openPosition({
    id: "pos-below",
    postId: "thesis-below",
    authorXId: "author-below",
    contract,
    entryPriceEth: price * 2, // current price is HALF of entry → a loss → must reject
  });
  await store.savePosition(pos);

  await processAuthorCloseRequests([
    closeReply({ authorXId: "author-below", inReplyToId: "thesis-below", text: "close", postId: "below-reply" }),
  ]);

  const fresh = (await store.getAllPositions()).find((p) => p.id === "pos-below");
  assert.equal(fresh?.status, "open", "a manual close at a loss (<+20%) must be refused");
});

test("author-close: the author's close ABOVE +20% executes (position closes)", async () => {
  const lotteryWas = config.holderLottery.enabled;
  (config.holderLottery as { enabled: boolean }).enabled = false; // keep settlement simple
  const store = getStore();
  const contract = "0xc105e0000000000000000000000000000000aa03";
  const price = await createBaseDataAdapter().getPriceEth(contract);
  const pos = openPosition({
    id: "pos-above",
    postId: "thesis-above",
    authorXId: "author-above",
    contract,
    entryPriceEth: price / 3, // current price is 3× entry → well above +20% → approve
  });
  await store.savePosition(pos);

  try {
    await processAuthorCloseRequests([
      closeReply({ authorXId: "author-above", inReplyToId: "thesis-above", text: "close it", postId: "above-reply" }),
    ]);

    const fresh = (await store.getAllPositions()).find((p) => p.id === "pos-above");
    assert.equal(fresh?.status, "closed", "an author close well above +20% must execute");
  } finally {
    (config.holderLottery as { enabled: boolean }).enabled = lotteryWas;
  }
});
