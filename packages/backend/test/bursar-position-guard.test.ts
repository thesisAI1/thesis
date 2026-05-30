/**
 * L8 (audit #8, bursar.ts) — never double-expose to the same contract.
 *
 * The bug: runBursar gates on score / cooldown / daily-limit / portfolio size
 * but never checks whether we ALREADY hold an open position in this contract.
 * Two theses about the same token (or a simple re-post) → two buys → double
 * exposure, and the monitor then tracks two positions in the same token with
 * independent TP/SL exit logic.
 *
 * RED  (no guard): the Bursar opens a SECOND position → result.position != null.
 * GREEN (guard):   the Bursar skips with an "already holding" reason.
 *
 * A second test pins that the guard is CONTRACT-SCOPED — it must not turn into
 * a blanket "don't buy anything while any position is open".
 */

import "./helpers/isolate-store.js"; // temp DATA_DIR + mock mode before config loads
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position, Submission, TokenReport, Verdict } from "@thesis/shared";
import { getStore } from "../src/store/index.js";
import { runBursar } from "../src/agents/bursar.js";

const CONTRACT = "0x2222222222222222222222222222222222222222";

function healthyToken(contract = CONTRACT): TokenReport {
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

/** A clean BUY verdict that PASSES the hard gate, so the Bursar proceeds far
 *  enough to reach the dedup guard under test. */
function buyVerdict(contract = CONTRACT): Verdict {
  return {
    submission: {
      postId: `post-${contract.slice(2, 8)}`,
      authorXId: "111",
      authorHandle: "@dup",
      thesisText: "Same token, second post.",
      contractAddress: contract,
      chain: "base",
      postUrl: "https://x.com/dup/status/2",
      postedAt: new Date().toISOString(),
    } as Submission,
    authorReport: {
      authorXId: "111",
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

function openPositionIn(contract: string): Position {
  return {
    id: `pos-existing-${contract.slice(2, 8)}`,
    postId: "post-existing",
    authorXId: "999",
    authorHandle: "@holder",
    postUrl: "https://x.com/holder/status/1",
    order: {
      contractAddress: contract,
      chain: "base",
      amountInEth: 0.15,
      takeProfits: [{ priceX: 2, sellFraction: 1 }],
      stopLossX: 0.7,
    },
    status: "open",
    entryPriceEth: 1e-6,
    entryTxHash: "0xentry",
    remainingFraction: 1,
    tiersHit: 0,
    realisedPnlEth: 0,
    openedAt: new Date().toISOString(),
  };
}

test("Bursar refuses a second buy when an open position already holds the contract", async () => {
  const store = getStore();
  await store.savePosition(openPositionIn(CONTRACT));

  const result = await runBursar(buyVerdict(CONTRACT));

  assert.equal(
    result.position,
    null,
    "must NOT open a second position in a contract we already hold",
  );
  assert.match(
    result.skippedReason ?? "",
    /already hold/i,
    `skippedReason should explain the dedup — got: ${result.skippedReason}`,
  );
});

test("Bursar's dedup guard is contract-scoped (a different contract is not blocked by it)", async () => {
  const store = getStore();
  await store.savePosition(openPositionIn(CONTRACT));

  const other = "0x5555555555555555555555555555555555555555";
  const result = await runBursar(buyVerdict(other));

  // It may or may not buy (cooldown / daily-limit are separate concerns), but it
  // must NOT be blocked by the already-holding guard — that guard is per-contract.
  assert.doesNotMatch(
    result.skippedReason ?? "",
    /already hold/i,
    "the dedup guard must not block a different contract",
  );
});
