/**
 * F1 — a buy must never leave bought tokens with no Position (silent loss).
 *
 * runBursar executes an on-chain buy and THEN saves the Position. A crash in
 * that window would buy tokens the monitor never sees (no TP/SL/settlement —
 * permanent silent loss). The fix is a write-ahead pending-buy marker: recorded
 * before the buy, cleared after the Position is saved (or the buy reverts). A
 * marker that survives to startup is logged loudly for manual reconciliation.
 *
 * These pin: a successful buy leaves no marker, a reverted buy leaves no marker,
 * and an orphaned marker (the crash case) stays visible for recovery.
 */

import "./helpers/isolate-store.js"; // temp DATA_DIR + mock mode before config loads
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Submission, TokenReport, Verdict } from "@thesis/shared";
import type { ChainAdapter, SwapResult } from "../src/adapters/chain/index.js";
import { __setChainForTest } from "../src/adapters/chain/index.js";
import { config } from "../src/config.js";
import { getStore } from "../src/store/index.js";
import { runBursar } from "../src/agents/bursar.js";

function healthyToken(contract: string): TokenReport {
  return {
    contractAddress: contract,
    chain: "base",
    score: 85,
    launchpad: "clanker",
    liquidityUsd: 50_000,
    marketCapUsd: 500_000,
    launchedAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    top10Concentration: 0.15,
    topHolders: [],
    isHoneypot: false,
    flags: [],
    reasoning: [],
  } as TokenReport;
}

function buyVerdict(contract: string, postId: string): Verdict {
  return {
    submission: {
      postId,
      authorXId: `${postId}-author`,
      authorHandle: "@author",
      thesisText: "clean thesis",
      contractAddress: contract,
      chain: "base",
      postUrl: `https://x.com/x/status/${postId}`,
      postedAt: new Date().toISOString(),
    } as Submission,
    authorReport: {
      authorXId: `${postId}-author`,
      score: 80,
      isLikelyBot: false,
      accountAgeDays: 400,
      smartFollowerCount: 50,
      pastContracts: [],
      pastHitRate: 0.3,
      flags: [],
      reasoning: [],
    },
    tokenReport: healthyToken(contract),
    grade: "A",
    decision: "BUY",
    confidence: 1,
    positionSizePct: 0.1,
    rationale: "clean buy",
    reasoning: [],
  } as Verdict;
}

/** A chain whose buy() reverts (the swap failed before any tokens moved). */
class RevertingBuyChain implements ChainAdapter {
  getWalletAddress(): string {
    return "0x7ad1e9c0d4b3a2f1e8d7c6b5a4938271605f4e3d";
  }
  async getWalletBalanceEth(): Promise<number> {
    return 1.5;
  }
  async buy(): Promise<SwapResult> {
    throw new Error("buy reverted on-chain");
  }
  async sell(): Promise<SwapResult> {
    return { txHash: "0xsell", amountOut: 0, priceEth: 1 };
  }
  async getTokenPriceEth(): Promise<number> {
    return 1;
  }
  async sendEth(): Promise<string> {
    return "0xsend";
  }
  async buybackAndBurn(): Promise<{ txHash: string; tokensBurned: number }> {
    return { txHash: "0xburn", tokensBurned: 1 };
  }
}

/** Run fn with the buy rate-limits disabled (cooldown + daily cap), so a buy in
 *  this test isn't blocked by buys other suite files recorded in the shared store. */
async function withNoRateLimit(fn: () => Promise<void>): Promise<void> {
  const t = config.trading as { buyCooldownMinutes: number; maxBuysPerDay: number };
  const prevCd = t.buyCooldownMinutes;
  const prevMax = t.maxBuysPerDay;
  t.buyCooldownMinutes = 0;
  t.maxBuysPerDay = 100_000;
  try {
    await fn();
  } finally {
    t.buyCooldownMinutes = prevCd;
    t.maxBuysPerDay = prevMax;
  }
}

test("F1: a successful buy leaves NO orphan pending marker", async () => {
  await withNoRateLimit(async () => {
    __setChainForTest(null); // mock chain — buys succeed
    const store = getStore();
    const postId = "f1-ok";
    const res = await runBursar(buyVerdict("0xF1F100000000000000000000000000000000ab01", postId));
    assert.ok(res.position, "a clean buy should open a position");
    const orphans = (await store.getPendingBuys()).filter((b) => b.postId === postId);
    assert.equal(orphans.length, 0, "the pending marker must be cleared once the position is saved");
  });
});

test("F1: a reverted buy clears the pending marker (no orphan)", async () => {
  await withNoRateLimit(async () => {
    __setChainForTest(new RevertingBuyChain());
    const store = getStore();
    const postId = "f1-revert";
    try {
      await assert.rejects(
        runBursar(buyVerdict("0xF1F100000000000000000000000000000000ab02", postId)),
        /buy reverted/,
      );
      const orphans = (await store.getPendingBuys()).filter((b) => b.postId === postId);
      assert.equal(orphans.length, 0, "a reverted buy must not leave an orphan marker");
    } finally {
      __setChainForTest(null);
    }
  });
});

test("F1: an orphaned marker (crash mid-buy) stays visible for reconciliation", async () => {
  const store = getStore();
  const postId = "f1-orphan";
  // Simulate the crash window: intent recorded, position never saved, never cleared.
  await store.recordPendingBuy({
    postId,
    contractAddress: "0xF1F100000000000000000000000000000000ab03",
    amountInEth: 0.1,
    at: new Date().toISOString(),
  });
  const orphans = (await store.getPendingBuys()).filter((b) => b.postId === postId);
  assert.equal(orphans.length, 1, "a buy initiated without a saved position must remain detectable on startup");
});
