/**
 * Wave 5 — the Bursar buys on the AUTHORITATIVE (resolved) chain.
 *
 * The order's chain must come from the Auditor's tokenReport.chain (resolved by
 * DexScreener), not the submission's address-shape guess — so a Solana win
 * opens a Solana position sized off the Solana wallet and traded via the Solana
 * adapter. Base behavior is unchanged.
 */

import "./helpers/isolate-store.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AuthorReport, Submission, TokenReport, Verdict } from "@thesis/shared";
import { runBursar } from "../src/agents/bursar.js";

const SOL_MINT = "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfpump";

function verdict(chain: "base" | "solana", contractAddress: string): Verdict {
  const submission: Submission = {
    postId: `p-${chain}`,
    authorXId: "1",
    authorHandle: "@caller",
    thesisText: "healthy token, organic holders, strong momentum and real community",
    contractAddress,
    chain,
    postUrl: "https://x.com/caller/status/1",
    postedAt: new Date().toISOString(),
  };
  const authorReport: AuthorReport = {
    authorXId: "1",
    score: 80,
    isLikelyBot: false,
    accountAgeDays: 400,
    smartFollowerCount: 50,
    pastContracts: [],
    pastHitRate: 0.3,
    flags: [],
    reasoning: [],
  };
  const tokenReport: TokenReport = {
    contractAddress,
    chain,
    score: 85,
    launchpad: chain === "solana" ? "pumpfun" : "clanker",
    liquidityUsd: 80_000,
    marketCapUsd: 500_000,
    launchedAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
    top10Concentration: 0.15,
    topHolders: [],
    isHoneypot: false,
    flags: [],
    reasoning: [],
  };
  return {
    submission,
    authorReport,
    tokenReport,
    grade: "A",
    decision: "BUY",
    confidence: 0.9,
    positionSizePct: 0.07,
    rationale: "healthy",
    reasoning: [],
  };
}

test("Bursar: a Solana BUY opens a position with order.chain = solana", async () => {
  const result = await runBursar(verdict("solana", SOL_MINT));
  assert.ok(result.position, `expected a position; skipped: ${result.skippedReason}`);
  assert.equal(result.position.order.chain, "solana");
  assert.ok(result.position.entryPriceEth > 0, "filled at a positive SOL price");
  assert.equal(result.position.order.contractAddress, SOL_MINT);
});
