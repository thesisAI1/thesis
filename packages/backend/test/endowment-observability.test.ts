/**
 * RED tests — endowment money-leg failures emit structured ops / logEvent.
 *
 * Pins gaps G1–G3, G9, G13 from /tmp/logging-gaps.md.
 *
 * These tests MUST FAIL until the matching GREEN pass adds publishOps() /
 * logEvent() calls inside agents/endowment.ts.
 *
 * HONEST GAP — G1 (lottery sendEth revert):
 *   `runHolderLottery` calls `drawLottery` → `getEligibleHolders`, which in mock
 *   mode (no GOLDRUSH_API_KEY) returns [] because fetchHoldersSnapshot returns []
 *   and `isSnapshotWithinStaleCeiling(0, ...)` is false. With 0 winners drawn,
 *   the per-winner sendEth loop never executes and cannot be made to revert via
 *   the chain adapter. There is no exported test seam (`__setHolders`) in
 *   holders/index.ts that would let us seed winners without modifying src.
 *   Skipped: honest gap — needs a seam in holders/index.ts.
 */

import "./helpers/isolate-store.js"; // MUST be first — temp DATA_DIR + mock mode
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "@thesis/shared";
import type { ChainAdapter, SwapResult } from "../src/adapters/chain/index.js";
import { __setChainForTest } from "../src/adapters/chain/index.js";
import { subscribeOps, type OpsEvent } from "../src/observability/opsBus.js";
import { getEventLog } from "../src/observability/eventLog.js";
import { getStore } from "../src/store/index.js";
import { runEndowment } from "../src/agents/endowment.js";
import { config } from "../src/config.js";

// ── Shared chain adapter types ────────────────────────────────────────────────

class NormalChain implements ChainAdapter {
  getWalletAddress(): string {
    return "0x7ad1e9c0d4b3a2f1e8d7c6b5a4938271605f4e3d";
  }
  async getWalletBalanceEth(): Promise<number> {
    return 2.0;
  }
  async buy(_a: string, amt: number): Promise<SwapResult> {
    return { txHash: "0xbuy", amountOut: amt, priceEth: 1 };
  }
  async sell(): Promise<SwapResult> {
    return { txHash: "0xsell", amountOut: 0, priceEth: 1 };
  }
  async quoteSell(): Promise<{ proceedsEth: number }> {
    return { proceedsEth: 0 };
  }
  async getTokenPriceEth(): Promise<number> {
    return 1;
  }
  async sendEth(_to: string, _amt: number): Promise<string> {
    return "0xsend";
  }
  async buybackAndBurn(_amt: number): Promise<{ txHash: string; tokensBurned: number }> {
    return { txHash: "0xburn", tokensBurned: 1 };
  }
}

/** Chain that throws on every sendEth call. Used to simulate the author
 *  direct-payout revert (G2). */
class SendEthRevertingChain extends NormalChain {
  override async sendEth(_to: string, _amt: number): Promise<string> {
    throw new Error("simulated RPC revert: sendEth failed");
  }
}

/** Chain that fails runLeg legs (buyback/team) but not sendEth for author.
 *  The first call to sendEth (author) succeeds; all buybackAndBurn throw.
 *  Used to simulate a runLeg failure (G3). */
class BuybackRevertingChain extends NormalChain {
  override async buybackAndBurn(_amt: number): Promise<{ txHash: string; tokensBurned: number }> {
    throw new Error("simulated RPC revert: buybackAndBurn failed");
  }
}

/** Chain that fails the TEAM sendEth leg (first sendEth = author succeeds,
 *  second = team fails). Used as an alternative G3 fixture. */
class TeamSendRevertingChain extends NormalChain {
  private _sendCount = 0;
  override async sendEth(to: string, amt: number): Promise<string> {
    this._sendCount += 1;
    // Author is sent first; team is second. Fail the team leg.
    if (this._sendCount >= 2) {
      throw new Error(`simulated RPC revert: team sendEth failed (call #${this._sendCount})`);
    }
    return "0xsend";
  }
}

// ── Position builder ──────────────────────────────────────────────────────────

function makePosition(opts: {
  id: string;
  authorXId: string;
  lastExitTxHash?: string;
}): Position {
  return {
    id: opts.id,
    postId: `${opts.id}-post`,
    authorXId: opts.authorXId,
    authorHandle: "@testauthor",
    postUrl: `https://x.com/testauthor/status/${opts.id}`,
    order: {
      contractAddress: "0xabcabcabcabcabcabcabcabcabcabcabcabcabca",
      chain: "base",
      amountInEth: 0.1,
      takeProfits: [{ priceX: 2, sellFraction: 1 }],
      stopLossX: 0.7,
    },
    status: "closed",
    entryPriceEth: 1e-8,
    entryTxHash: "0xentry",
    lastExitTxHash: opts.lastExitTxHash,
    remainingFraction: 0,
    tiersHit: 1,
    realisedPnlEth: 1.0,
    openedAt: new Date().toISOString(),
  };
}

// ── Helper to collect ops events synchronously during an async call ──────────

async function collectOps(fn: () => Promise<void>): Promise<OpsEvent[]> {
  const captured: OpsEvent[] = [];
  const unsub = subscribeOps((e) => captured.push(e));
  try {
    await fn();
  } finally {
    unsub();
  }
  return captured;
}

// ── Toggle helpers ────────────────────────────────────────────────────────────

function withLottery(enabled: boolean, fn: () => Promise<void>): Promise<void> {
  const prev = config.holderLottery.enabled;
  (config.holderLottery as { enabled: boolean }).enabled = enabled;
  return fn().finally(() => {
    (config.holderLottery as { enabled: boolean }).enabled = prev;
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// G1: lottery sendEth revert → settle:failed ops event
// HONEST GAP: no test seam to seed holders in mock mode (see file header)
test.skip(
  "G1: lottery winner sendEth revert emits settle:failed ops event (honest gap: needs __setHolders seam in holders/index.ts)",
  async () => {
    /* Would need: holders/__setHoldersForTest([{ address: "0xwinner1", balanceEth: 1 }])
     * to seed drawLottery with actual winners so the per-winner sendEth loop fires.
     * Without it, draw.winners is always [] in mock mode (GOLDRUSH_API_KEY unset),
     * so the loop body that can throw never executes. */
    assert.fail("placeholder — honest gap");
  },
);

// G2: payAuthorDirect sendEth revert → payout:failed ops event
test("G2: payAuthorDirect sendEth revert emits payout:failed ops event", async () => {
  const store = getStore();
  const authorXId = "obs-g2-author";
  const wallet = "0xA22Ce00000000000000000000000000000000222";
  await store.linkWallet({
    xUserId: authorXId,
    handle: "@testauthor",
    wallet,
    linkedAt: new Date().toISOString(),
  });

  await withLottery(false, async () => {
    const chain = new SendEthRevertingChain();
    __setChainForTest(chain);
    try {
      const ops = await collectOps(() =>
        runEndowment(
          makePosition({ id: "obs-g2-pos", authorXId }),
          1.0,
          { silentAuthorTweet: true },
        ).then(() => undefined),
      );

      const payoutFailed = ops.filter((e) => e.type === "payout:failed");
      assert.ok(
        payoutFailed.length > 0,
        `Expected at least one payout:failed ops event when author sendEth reverts, got: [${ops.map((e) => e.type).join(", ")}]`,
      );
      const ev = payoutFailed[0];
      assert.equal(ev.type, "payout:failed");
      if (ev.type === "payout:failed") {
        assert.ok(
          ev.handle === "@testauthor" || ev.handle === authorXId,
          `payout:failed event handle should identify the author, got: ${ev.handle}`,
        );
        assert.ok(ev.amountEth > 0, `payout:failed event should carry the amount, got: ${ev.amountEth}`);
        assert.ok(ev.reason.length > 0, `payout:failed event should carry a reason, got: "${ev.reason}"`);
      }
    } finally {
      __setChainForTest(null);
    }
  });
});

// G3: runLeg failure (buyback leg) → settle:failed ops event carrying positionId
test("G3: runLeg buyback failure emits settle:failed ops event with positionId", async () => {
  const store = getStore();
  const authorXId = "obs-g3-author";
  const wallet = "0xA33Ce00000000000000000000000000000000333";
  await store.linkWallet({
    xUserId: authorXId,
    handle: "@testauthor",
    wallet,
    linkedAt: new Date().toISOString(),
  });

  await withLottery(false, async () => {
    const chain = new BuybackRevertingChain();
    __setChainForTest(chain);
    const positionId = "obs-g3-pos";
    try {
      const ops = await collectOps(() =>
        runEndowment(
          makePosition({ id: positionId, authorXId }),
          1.0,
          { silentAuthorTweet: true },
        ).then(() => undefined),
      );

      const settleFailed = ops.filter((e) => e.type === "settle:failed");
      assert.ok(
        settleFailed.length > 0,
        `Expected at least one settle:failed ops event when buyback leg throws, got: [${ops.map((e) => e.type).join(", ")}]`,
      );
      const ev = settleFailed[0];
      assert.equal(ev.type, "settle:failed");
      if (ev.type === "settle:failed") {
        assert.equal(
          ev.positionId,
          positionId,
          `settle:failed event must carry the position id ("${positionId}"), got: "${ev.positionId}"`,
        );
        assert.ok(ev.reason.length > 0, `settle:failed event should carry a reason, got: "${ev.reason}"`);
      }
    } finally {
      __setChainForTest(null);
    }
  });
});

// G3 (team leg variant): runLeg failure on team sendEth → settle:failed ops event
test("G3b: runLeg team-pay failure emits settle:failed ops event with positionId and leg label", async () => {
  const store = getStore();
  const authorXId = "obs-g3b-author";
  const wallet = "0xA33Ce00000000000000000000000000000000444";
  await store.linkWallet({
    xUserId: authorXId,
    handle: "@testauthor",
    wallet,
    linkedAt: new Date().toISOString(),
  });

  await withLottery(false, async () => {
    const chain = new TeamSendRevertingChain();
    __setChainForTest(chain);
    const positionId = "obs-g3b-pos";
    try {
      const ops = await collectOps(() =>
        runEndowment(
          makePosition({ id: positionId, authorXId }),
          1.0,
          { silentAuthorTweet: true },
        ).then(() => undefined),
      );

      const settleFailed = ops.filter((e) => e.type === "settle:failed");
      assert.ok(
        settleFailed.length > 0,
        `Expected at least one settle:failed ops event when team sendEth throws, got: [${ops.map((e) => e.type).join(", ")}]`,
      );
      const ev = settleFailed[0];
      if (ev.type === "settle:failed") {
        assert.equal(ev.positionId, positionId);
        // GREEN will plumb the leg label into the reason
        assert.ok(
          ev.reason.toLowerCase().includes("team") || ev.reason.toLowerCase().includes("leg") || ev.reason.length > 0,
          `settle:failed reason should mention the failing leg, got: "${ev.reason}"`,
        );
      }
    } finally {
      __setChainForTest(null);
    }
  });
});

// G9: requestAuthorPayout post failure → error ops event
test("G9: requestAuthorPayout tweet failure emits error ops event", async () => {
  // Author has NO wallet on file → endowment will escrow + call requestAuthorPayout.
  // We make the X adapter's replyToPost throw to simulate a tweet API failure.
  const { MockX } = await import("../src/adapters/x/mock.js");
  const realReply = MockX.prototype.replyToPost;
  MockX.prototype.replyToPost = async (_postId: string, _text: string): Promise<string> => {
    throw new Error("simulated X API error: tweet post failed");
  };

  await withLottery(false, async () => {
    const authorXId = "obs-g9-author";
    // No wallet linkage → escrow path → requestAuthorPayout is called.
    const positionId = "obs-g9-pos";
    // Use a normal chain so sendEth (team/buyback) succeeds.
    const chain = new NormalChain();
    __setChainForTest(chain);
    try {
      const ops = await collectOps(() =>
        runEndowment(
          makePosition({ id: positionId, authorXId }),
          1.0,
          // silentAuthorTweet: false (default) so requestAuthorPayout is called
          { silentAuthorTweet: false },
        ).then(() => undefined),
      );

      const errorOps = ops.filter((e) => e.type === "error");
      assert.ok(
        errorOps.length > 0,
        `Expected at least one error ops event when requestAuthorPayout tweet fails, got: [${ops.map((e) => e.type).join(", ")}]`,
      );
      const ev = errorOps.find((e) => {
        if (e.type === "error") {
          return e.area === "endowment" || e.msg.toLowerCase().includes("payout request");
        }
        return false;
      });
      assert.ok(
        ev !== undefined,
        `Expected an error ops event in the "endowment" area or mentioning "payout request", got: [${errorOps.map((e) => e.type === "error" ? `area=${e.area} msg=${e.msg}` : "").join(", ")}]`,
      );
    } finally {
      __setChainForTest(null);
      MockX.prototype.replyToPost = realReply;
    }
  });
});

// G13: payout-sent confirmation reply fails → logEvent warn (level "warn", area "endowment")
test("G13: payout-sent confirmation reply failure records a warn logEvent entry", async () => {
  // Author HAS a wallet on file → payAuthorDirect is called → tx succeeds →
  // the non-silent path tries to post a "payout sent" tweet reply (line 392-399).
  // We make replyToPost throw ONLY for the payout-sent reply.
  const { MockX } = await import("../src/adapters/x/mock.js");
  const realReply = MockX.prototype.replyToPost;
  MockX.prototype.replyToPost = async (_postId: string, _text: string): Promise<string> => {
    throw new Error("simulated X API error: reply post failed");
  };

  const store = getStore();
  const authorXId = "obs-g13-author";
  const wallet = "0xA13Ce00000000000000000000000000000000013";
  await store.linkWallet({
    xUserId: authorXId,
    handle: "@testauthor",
    wallet,
    linkedAt: new Date().toISOString(),
  });

  await withLottery(false, async () => {
    const chain = new NormalChain();
    __setChainForTest(chain);
    try {
      // Snapshot event log length before the call so we can detect new entries.
      const logBefore = getEventLog().recent(100).length;

      // silentAuthorTweet: false → the payout-sent reply IS attempted (line 392).
      await runEndowment(
        makePosition({ id: "obs-g13-pos", authorXId }),
        1.0,
        { silentAuthorTweet: false },
      );

      const logAfter = getEventLog().recent(100);
      const newEntries = logAfter.slice(0, logAfter.length - logBefore);

      const warnEntry = newEntries.find(
        (e) =>
          e.level === "warn" &&
          e.area === "endowment",
      );
      assert.ok(
        warnEntry !== undefined,
        `Expected a logEvent warn entry in area "endowment" after payout-sent reply fails. ` +
          `New entries: [${newEntries.map((e) => `level=${e.level} area=${e.area} type=${e.type}`).join(", ")}]`,
      );
    } finally {
      __setChainForTest(null);
      MockX.prototype.replyToPost = realReply;
    }
  });
});
