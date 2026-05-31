/**
 * F2 (idempotency) + F3 (address validation) for the author-payout claim path.
 *
 * F3 — the bot sends real, irreversible ETH to whatever a reply contains. Guard
 * the two ways that goes wrong: an AMBIGUOUS reply (more than one distinct
 * address — don't guess), and a MALFORMED / bad-EIP-55-checksum address (a
 * fat-fingered mixed-case char). A single valid (incl. all-lowercase) address
 * still pays.
 *
 * F2 — a completed payout atomically clears escrow + request, so a re-poll of
 * the same reply cannot pay twice.
 */

import "./helpers/isolate-store.js"; // temp DATA_DIR + mock mode before config loads
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAddress } from "viem";
import type { ChainAdapter, SwapResult } from "../src/adapters/chain/index.js";
import { __setChainForTest } from "../src/adapters/chain/index.js";
import { getStore } from "../src/store/index.js";
import { processWalletReplies } from "../src/payout/index.js";
import type { XPost } from "../src/adapters/x/index.js";

class RecordingChain implements ChainAdapter {
  readonly sends: { to: string; amountEth: number }[] = [];
  getWalletAddress(): string {
    return "0x7ad1e9c0d4b3a2f1e8d7c6b5a4938271605f4e3d";
  }
  async getWalletBalanceEth(): Promise<number> {
    return 1.5;
  }
  async buy(_a: string, amountInEth: number): Promise<SwapResult> {
    return { txHash: "0xbuy", amountOut: amountInEth, priceEth: 1 };
  }
  async sell(): Promise<SwapResult> {
    return { txHash: "0xsell", amountOut: 0, priceEth: 1 };
  }
  async getTokenPriceEth(): Promise<number> {
    return 1;
  }
  async sendEth(to: string, amountEth: number): Promise<string> {
    this.sends.push({ to, amountEth });
    return "0xsend";
  }
  async buybackAndBurn(): Promise<{ txHash: string; tokensBurned: number }> {
    return { txHash: "0xburn", tokensBurned: 1 };
  }
}

async function seedRequest(authorId: string, tweetId: string, owedEth: number): Promise<void> {
  const store = getStore();
  await store.addPayoutRequest({
    requestTweetId: tweetId,
    xUserId: authorId,
    handle: "@author",
    threadPostId: `thesis-${authorId}`,
    requestedAt: new Date().toISOString(),
  });
  await store.addEscrow(authorId, "@author", owedEth);
}

function reply(authorId: string, tweetId: string, text: string, postId: string): XPost {
  return {
    postId,
    authorXId: authorId,
    authorHandle: "@author",
    text,
    createdAt: new Date().toISOString(),
    url: `https://x.com/x/status/${postId}`,
    authorFollowers: 10,
    engagement: 0,
    inReplyToId: tweetId,
  };
}

const GOOD = "0xa11ce00000000000000000000000000000000a11"; // valid (all-lowercase)
const GOOD2 = "0xb0b0000000000000000000000000000000000b0b"; // valid (all-lowercase)
// All-uppercase hex with letters → not all-lowercase and not a valid checksum → invalid.
const BAD_CHECKSUM = "0xAABBCCDDEEFFAABBCCDDEEFFAABBCCDDEEFFAABB";

test("F3 fixtures are what we think (meta-check)", () => {
  assert.equal(isAddress(GOOD), true, "all-lowercase address must be accepted");
  assert.equal(isAddress(BAD_CHECKSUM), false, "bad-checksum address must be rejected by isAddress");
});

test("F3: an AMBIGUOUS reply (two distinct addresses) is NOT paid", async () => {
  const store = getStore();
  await seedRequest("amb-author", "amb-tweet", 0.5);
  const chain = new RecordingChain();
  __setChainForTest(chain);
  try {
    await processWalletReplies([
      reply("amb-author", "amb-tweet", `use ${GOOD} or maybe ${GOOD2}`, "amb-reply"),
    ]);
    assert.equal(chain.sends.length, 0, "must not guess which of two addresses to pay");
    assert.equal((await store.getEscrow("amb-author"))?.amountEth, 0.5, "escrow left intact");
  } finally {
    __setChainForTest(null);
  }
});

test("F3: a bad-checksum address is NOT paid", async () => {
  const store = getStore();
  await seedRequest("bad-author", "bad-tweet", 0.5);
  const chain = new RecordingChain();
  __setChainForTest(chain);
  try {
    await processWalletReplies([
      reply("bad-author", "bad-tweet", `here: ${BAD_CHECKSUM}`, "bad-reply"),
    ]);
    assert.equal(chain.sends.length, 0, "a malformed/bad-checksum address must be rejected");
    assert.equal((await store.getEscrow("bad-author"))?.amountEth, 0.5, "escrow left intact");
  } finally {
    __setChainForTest(null);
  }
});

test("F3: a single valid (lowercase) address IS paid", async () => {
  const store = getStore();
  await seedRequest("ok-author", "ok-tweet", 0.5);
  const chain = new RecordingChain();
  __setChainForTest(chain);
  try {
    await processWalletReplies([reply("ok-author", "ok-tweet", `my wallet ${GOOD}`, "ok-reply")]);
    assert.equal(chain.sends.length, 1, "a clean single valid address must be paid");
    assert.equal(chain.sends[0]?.to, GOOD);
  } finally {
    __setChainForTest(null);
  }
});

test("F2: a re-poll of the same wallet reply does NOT pay twice", async () => {
  const store = getStore();
  await seedRequest("dup-author", "dup-tweet", 0.5);
  const chain = new RecordingChain();
  __setChainForTest(chain);
  try {
    const r = reply("dup-author", "dup-tweet", `wallet ${GOOD}`, "dup-reply");
    await processWalletReplies([r]); // pays once → clearPayout removes escrow + request
    await processWalletReplies([r]); // re-poll: request is gone → no second send
    assert.equal(chain.sends.length, 1, "the author must be paid exactly once across re-polls");
    assert.equal(await store.getEscrow("dup-author"), null, "escrow cleared atomically");
    // Scope to THIS author — the shared process store also holds other tests'
    // (deliberately un-cleared) rejected requests.
    const stillOpen = (await store.getPayoutRequests()).filter((r) => r.xUserId === "dup-author");
    assert.equal(stillOpen.length, 0, "this author's request cleared atomically with the escrow");
  } finally {
    __setChainForTest(null);
  }
});
