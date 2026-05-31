/**
 * Tier A — author-payout ANTI-HIJACK (payout/index.ts:handleWalletReply).
 *
 * When a winning trade closes and the author has no wallet on file, the
 * Endowment escrows their 25% and posts a "reply with your Base wallet" tweet.
 * The author claims it by REPLYING to that exact tweet with a 0x address.
 *
 * SECURITY: only the ORIGINAL author (matched by numeric X id, NOT @handle) may
 * claim. A reply from anyone else — even to the right tweet, even carrying a
 * valid wallet — must be ignored and the escrow left untouched. This is a
 * direct money-theft guard, and it was previously UNTESTED (the X mock even
 * seeds an imposter, but nothing asserted it gets rejected).
 *
 * The imposter test is a real guard: neutralizing the id check in
 * handleWalletReply makes it go RED (verified during development).
 *
 * Each test uses UNIQUE author/tweet ids — addEscrow is additive and the file
 * store is a process-wide singleton shared across the suite, so shared ids
 * would double an escrow and corrupt the amount assertions.
 */

import "./helpers/isolate-store.js"; // temp DATA_DIR + mock mode before config loads
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChainAdapter, SwapResult } from "../src/adapters/chain/index.js";
import { __setChainForTest } from "../src/adapters/chain/index.js";
import { getStore } from "../src/store/index.js";
import { processWalletReplies } from "../src/payout/index.js";
import type { XPost } from "../src/adapters/x/index.js";

/** Records every sendEth so we can prove a thief is never paid. */
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

async function seedRequest(opts: {
  authorId: string;
  tweetId: string;
  owedEth: number;
}): Promise<void> {
  const store = getStore();
  await store.addPayoutRequest({
    requestTweetId: opts.tweetId,
    xUserId: opts.authorId,
    handle: "@author",
    threadPostId: `thesis-${opts.authorId}`,
    requestedAt: new Date().toISOString(),
  });
  await store.addEscrow(opts.authorId, "@author", opts.owedEth);
}

function reply(opts: {
  authorXId: string;
  text: string;
  postId: string;
  inReplyToId: string;
}): XPost {
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

test("payout: an imposter replying to the request tweet is NOT paid (escrow untouched)", async () => {
  const store = getStore();
  const authorId = "alice-imposter-case";
  const tweetId = "req-tweet-imposter";
  await seedRequest({ authorId, tweetId, owedEth: 0.5 });

  const chain = new RecordingChain();
  __setChainForTest(chain);
  try {
    const passthrough = await processWalletReplies([
      reply({
        authorXId: "thief-bob", // NOT the author id
        text: "here you go 0xBAD0000000000000000000000000000000000bAd",
        postId: "imposter-reply-1",
        inReplyToId: tweetId,
      }),
    ]);

    assert.equal(chain.sends.length, 0, "no ETH may be sent for an imposter reply");
    const escrow = await store.getEscrow(authorId);
    assert.equal(escrow?.amountEth, 0.5, "the author's escrow must be left fully intact");
    assert.equal(
      await store.getRegistryEntry(authorId),
      null,
      "the imposter's wallet must NOT be linked to the author",
    );
    assert.equal(
      passthrough.length,
      0,
      "a reply to our payout tweet is consumed, never forwarded to triage as a thesis",
    );
  } finally {
    __setChainForTest(null);
  }
});

test("payout: the original author IS paid exactly once (escrow cleared, wallet linked)", async () => {
  const store = getStore();
  const authorId = "alice-legit-case";
  const tweetId = "req-tweet-legit";
  // All-lowercase so it passes the F3 EIP-55 checksum validation (a mixed-case
  // address would need a correct checksum).
  const wallet = "0xa11ce00000000000000000000000000000000a11";
  await seedRequest({ authorId, tweetId, owedEth: 0.5 });

  const chain = new RecordingChain();
  __setChainForTest(chain);
  try {
    await processWalletReplies([
      reply({
        authorXId: authorId, // the real author
        text: `my payout wallet is ${wallet} thanks!`,
        postId: "legit-reply-1",
        inReplyToId: tweetId,
      }),
    ]);

    assert.equal(chain.sends.length, 1, "the author must be paid exactly once");
    assert.equal(chain.sends[0]?.to, wallet, "must pay the wallet in the author's reply");
    assert.equal(chain.sends[0]?.amountEth, 0.5, "must pay the full escrowed amount");

    const escrow = await store.getEscrow(authorId);
    assert.ok(!escrow || escrow.amountEth === 0, "escrow must be cleared after a successful payout");
    const reg = await store.getRegistryEntry(authorId);
    assert.equal(reg?.wallet, wallet, "the author's wallet must be linked for future direct payouts");
  } finally {
    __setChainForTest(null);
  }
});

test("payout: a reply to a NON-payout tweet passes through to triage untouched", async () => {
  // A normal mention that happens to be a reply to some other tweet must not be
  // swallowed by the payout handler — it should flow on to triage as a thesis.
  const authorId = "alice-passthrough-case";
  const tweetId = "req-tweet-passthrough";
  await seedRequest({ authorId, tweetId, owedEth: 0.5 });

  const chain = new RecordingChain();
  __setChainForTest(chain);
  try {
    const normalMention = reply({
      authorXId: "some-other-user",
      text: "check out 0xCa11ab1e0000000000000000000000000000beef great thesis",
      postId: "normal-mention-1",
      inReplyToId: "an-unrelated-tweet-id", // NOT our payout request tweet
    });
    const passthrough = await processWalletReplies([normalMention]);

    assert.equal(chain.sends.length, 0, "no payout for a non-payout reply");
    assert.equal(passthrough.length, 1, "the mention must pass through to triage");
    assert.equal(passthrough[0]?.postId, "normal-mention-1");
  } finally {
    __setChainForTest(null);
  }
});
