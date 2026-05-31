/**
 * Wave 7 — Solana author payouts (per-chain wallet + registry).
 *
 * A Solana win escrows the author's 25% in SOL; the author claims by replying
 * with a base58 Solana wallet, and the send must go via the Solana chain. The
 * wallet-shape validation is chain-specific: a base58 reply is valid for a
 * Solana request; an EVM 0x reply is NOT (and vice-versa). The anti-hijack
 * guard (numeric X id) still holds.
 *
 * RED until PayoutRequest/escrow carry `chain` and payout validates+sends per
 * chain.
 */

import "./helpers/isolate-store.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import type { ChainAdapter, SwapResult } from "../src/adapters/chain/index.js";
import { __setChainForTest } from "../src/adapters/chain/index.js";
import { getStore } from "../src/store/index.js";
import { processWalletReplies } from "../src/payout/index.js";
import type { XPost } from "../src/adapters/x/index.js";

class RecordingChain implements ChainAdapter {
  readonly sends: { to: string; amountEth: number }[] = [];
  getWalletAddress(): string {
    return "MockTradingWa11et1111111111111111111111111111";
  }
  async getWalletBalanceEth(): Promise<number> {
    return 10;
  }
  async buy(_a: string, amountInEth: number): Promise<SwapResult> {
    return { txHash: "sig", amountOut: amountInEth, priceEth: 1 };
  }
  async sell(): Promise<SwapResult> {
    return { txHash: "sig", amountOut: 0, priceEth: 1 };
  }
  async getTokenPriceEth(): Promise<number> {
    return 1;
  }
  async quoteSell(): Promise<{ proceedsEth: number }> {
    return { proceedsEth: 0 };
  }
  async sendEth(to: string, amountEth: number): Promise<string> {
    this.sends.push({ to, amountEth });
    return "sendsig";
  }
  async buybackAndBurn(): Promise<{ txHash: string; tokensBurned: number }> {
    return { txHash: "burn", tokensBurned: 1 };
  }
}

async function seedSolanaRequest(authorId: string, tweetId: string, amount: number): Promise<void> {
  const store = getStore();
  await store.addEscrow(authorId, "@sol_author", amount, "solana");
  await store.addPayoutRequest({
    requestTweetId: tweetId,
    xUserId: authorId,
    handle: "@sol_author",
    threadPostId: `${tweetId}-thread`,
    requestedAt: new Date().toISOString(),
    chain: "solana",
  });
}

function reply(authorId: string, tweetId: string, text: string): XPost {
  return {
    postId: `reply-${tweetId}`,
    authorXId: authorId,
    authorHandle: "@sol_author",
    text,
    createdAt: new Date().toISOString(),
    url: `https://x.com/sol_author/status/${tweetId}`,
    authorFollowers: 100,
    engagement: 1,
    inReplyToId: tweetId,
  };
}

test("Solana payout: a base58 wallet reply from the author is paid in SOL", async () => {
  const rec = new RecordingChain();
  __setChainForTest(rec);
  try {
    const wallet = Keypair.generate().publicKey.toBase58();
    await seedSolanaRequest("sol-author-1", "sol-tweet-1", 2);
    await processWalletReplies([reply("sol-author-1", "sol-tweet-1", `gm! ${wallet}`)]);
    assert.ok(
      rec.sends.some((s) => s.to === wallet && s.amountEth === 2),
      `expected a 2 SOL send to ${wallet}; sends=${JSON.stringify(rec.sends)}`,
    );
    const entry = await getStore().getRegistryEntry("sol-author-1", "solana");
    assert.equal(entry?.wallet, wallet, "wallet linked under the solana registry");
  } finally {
    __setChainForTest(null);
  }
});

test("Solana payout: an EVM 0x reply to a Solana request is NOT paid (wrong shape)", async () => {
  const rec = new RecordingChain();
  __setChainForTest(rec);
  try {
    await seedSolanaRequest("sol-author-2", "sol-tweet-2", 1);
    await processWalletReplies([
      reply("sol-author-2", "sol-tweet-2", "here 0x36e807119529E44d6F36aD5CE24AeB87a4529ba3"),
    ]);
    assert.equal(rec.sends.length, 0, "an EVM address must not satisfy a Solana payout");
    const escrow = await getStore().getEscrow("sol-author-2", "solana");
    assert.ok((escrow?.amountEth ?? 0) > 0, "escrow stays intact when the reply is wrong-shape");
  } finally {
    __setChainForTest(null);
  }
});
