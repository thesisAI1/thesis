/**
 * F5 — author-close infra-fail feedback: when the price fetch fails (or returns
 * 0), the author must receive a reply explaining the transient failure — not
 * silently get nothing.
 *
 * MOCK NOTE: MockBaseData.getPriceEth is a pure math function that always
 * returns a positive number; it does not use fetch. To force the failure path
 * we monkey-patch the prototype method for the duration of each relevant test.
 * This is the smallest viable seam: no separate module required, no module
 * graph surgery, and the patch is always restored in a finally block.
 */

import "./helpers/isolate-store.js"; // MUST be first — temp DATA_DIR + mock mode
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "@thesis/shared";
import { getStore } from "../src/store/index.js";
import { processAuthorCloseRequests } from "../src/pipeline/author-actions.js";
import { MockBaseData } from "../src/adapters/basedata/mock.js";
import type { XPost } from "../src/adapters/x/index.js";

// --- fixtures ---------------------------------------------------------------

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
      takeProfits: [{ priceX: 5, sellFraction: 1 }],
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

function closeReply(opts: {
  authorXId: string;
  inReplyToId: string;
  text: string;
  postId: string;
}): XPost {
  return {
    postId: opts.postId,
    authorXId: opts.authorXId,
    authorHandle: "@author",
    text: opts.text,
    createdAt: new Date().toISOString(),
    url: `https://x.com/x/status/${opts.postId}`,
    authorFollowers: 10,
    engagement: 0,
    inReplyToId: opts.inReplyToId,
  };
}

// --- tests ------------------------------------------------------------------

test("author-close infra-fail: price fetch throws → reply sent, position stays open", async () => {
  // Patch MockBaseData so getPriceEth throws for this test.
  const realGetPrice = MockBaseData.prototype.getPriceEth;
  MockBaseData.prototype.getPriceEth = async (_addr: string) => {
    throw new Error("simulated price fetch failure");
  };

  // Track replyToPost calls via the mock X adapter (mock mode is active).
  // The mock X adapter used by createXAdapter() in mock mode posts silently —
  // we verify the author's position remains open (not silently closed/ignored)
  // AND that processAuthorCloseRequests does not throw.
  const store = getStore();
  const contract = "0xf5a1000000000000000000000000000000000001";
  const pos = openPosition({
    id: "pos-infra-fail",
    postId: "thesis-infra-fail",
    authorXId: "author-infra-1",
    contract,
    entryPriceEth: 0.001, // irrelevant — price fetch will throw before this is used
  });
  await store.savePosition(pos);

  try {
    // Must not throw even though price fetch throws.
    await processAuthorCloseRequests([
      closeReply({
        authorXId: "author-infra-1",
        inReplyToId: "thesis-infra-fail",
        text: "close it",
        postId: "infra-fail-reply",
      }),
    ]);

    // Position must remain open — we couldn't verify price so no close.
    const fresh = (await store.getAllPositions()).find((p) => p.id === "pos-infra-fail");
    assert.equal(
      fresh?.status,
      "open",
      "position must stay open when price fetch fails",
    );
  } finally {
    MockBaseData.prototype.getPriceEth = realGetPrice;
  }
});

test("author-close infra-fail: price returns zero → reply sent, position stays open", async () => {
  // Patch MockBaseData so getPriceEth returns 0 for this test.
  const realGetPrice = MockBaseData.prototype.getPriceEth;
  MockBaseData.prototype.getPriceEth = async (_addr: string) => 0;

  const store = getStore();
  const contract = "0xf5a1000000000000000000000000000000000002";
  const pos = openPosition({
    id: "pos-price-zero",
    postId: "thesis-price-zero",
    authorXId: "author-infra-2",
    contract,
    entryPriceEth: 0.001,
  });
  await store.savePosition(pos);

  try {
    await processAuthorCloseRequests([
      closeReply({
        authorXId: "author-infra-2",
        inReplyToId: "thesis-price-zero",
        text: "close",
        postId: "price-zero-reply",
      }),
    ]);

    const fresh = (await store.getAllPositions()).find((p) => p.id === "pos-price-zero");
    assert.equal(
      fresh?.status,
      "open",
      "position must stay open when price fetch returns zero",
    );
  } finally {
    MockBaseData.prototype.getPriceEth = realGetPrice;
  }
});

test("author-close infra-fail: price fetch failure does NOT silence the author (replyToPost called)", async () => {
  // Import X adapter module to spy on replyToPost.
  // We use the mock X adapter — verify it's called by checking it doesn't throw
  // and by capturing calls through a lightweight spy on the mock prototype.
  const { MockX } = await import("../src/adapters/x/mock.js");
  const repliesPosted: string[] = [];
  const realReply = MockX.prototype.replyToPost;
  MockX.prototype.replyToPost = async (postId: string, _text: string) => {
    repliesPosted.push(postId);
    return `mock-reply-${postId}`;
  };

  const realGetPrice = MockBaseData.prototype.getPriceEth;
  MockBaseData.prototype.getPriceEth = async (_addr: string) => {
    throw new Error("simulated network error");
  };

  const store = getStore();
  const contract = "0xf5a1000000000000000000000000000000000003";
  const pos = openPosition({
    id: "pos-reply-check",
    postId: "thesis-reply-check",
    authorXId: "author-infra-3",
    contract,
    entryPriceEth: 0.001,
  });
  await store.savePosition(pos);

  try {
    await processAuthorCloseRequests([
      closeReply({
        authorXId: "author-infra-3",
        inReplyToId: "thesis-reply-check",
        text: "close it",
        postId: "reply-check-post",
      }),
    ]);

    assert.ok(
      repliesPosted.includes("reply-check-post"),
      `expected replyToPost("reply-check-post") to be called on price-fail; got: [${repliesPosted.join(", ")}]`,
    );
  } finally {
    MockBaseData.prototype.getPriceEth = realGetPrice;
    MockX.prototype.replyToPost = realReply;
  }
});
