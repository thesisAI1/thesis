/**
 * Wave 5b — Base and Solana have INDEPENDENT buy cooldowns + daily limits.
 *
 * The anti-spam rate limit (buyCooldownMinutes, maxBuysPerDay) must be scoped
 * per chain — they are separate trading lanes. A Base buy must NOT gate a
 * Solana buy in the same window (and vice-versa); but two buys on the SAME
 * chain within the cooldown ARE blocked.
 *
 * RED today: the buy log is global, so a Base buy blocks a Solana buy.
 */

import "./helpers/isolate-store.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AuthorReport, Submission, TokenReport, Verdict } from "@thesis/shared";
import { config } from "../src/config.js";
import { runBursar } from "../src/agents/bursar.js";

function verdict(chain: "base" | "solana", contractAddress: string): Verdict {
  const submission: Submission = {
    postId: `p-${contractAddress.slice(0, 8)}`,
    authorXId: `a-${contractAddress.slice(0, 8)}`,
    authorHandle: "@caller",
    thesisText: "healthy token, organic holders, strong momentum and real community",
    contractAddress,
    chain,
    postUrl: "https://x.com/caller/status/1",
    postedAt: new Date().toISOString(),
  };
  const authorReport: AuthorReport = {
    authorXId: submission.authorXId,
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

test("a Base buy does NOT trigger the Solana cooldown (independent lanes)", async () => {
  // Ensure the cooldown is long enough that a shared log would block the 2nd buy.
  const prev = config.trading.buyCooldownMinutes;
  config.trading.buyCooldownMinutes = 30;
  try {
    const base = await runBursar(verdict("base", "0x36e807119529E44d6F36aD5CE24AeB87a4529ba3"));
    assert.ok(base.position, `base buy should open; skipped: ${base.skippedReason}`);

    const sol = await runBursar(verdict("solana", "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfpump"));
    assert.ok(
      sol.position,
      `solana buy must NOT be blocked by the base cooldown; skipped: ${sol.skippedReason}`,
    );
    assert.equal(sol.position.order.chain, "solana");

    // A SECOND Solana buy within the window IS blocked (same-chain cooldown holds).
    const sol2 = await runBursar(verdict("solana", "AnotherSo1anaMintForCooldownTestxxxxxxpump"));
    assert.equal(sol2.position, null, "second Solana buy in the window must be cooled down");
    assert.match(sol2.skippedReason ?? "", /cooldown/i);
  } finally {
    config.trading.buyCooldownMinutes = prev;
  }
});
