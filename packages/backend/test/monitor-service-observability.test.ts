/**
 * TDD RED — monitor/service observability gaps (G6 + G4).
 *
 * G6: settle() THREW / null / INCOMPLETE branches in monitor/index.ts each
 *     call log.error only; the `settle:failed` OpsEvent is declared in the
 *     union but emitted NOWHERE. These tests assert the missing publish call.
 *
 * G4: reconcilePendingBuys() in service.ts calls log.error only for each
 *     orphaned pending-buy; no `error` OpsEvent is published. The function is
 *     also module-private (not exported), so the GREEN fix must export it.
 *
 * RED phase: all four cases fail because the ops events are absent.
 */

import "./helpers/isolate-store.js"; // MUST be first — temp DATA_DIR + mock mode
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "@thesis/shared";
import type { ChainAdapter, SwapResult } from "../src/adapters/chain/index.js";
import { __setChainForTest } from "../src/adapters/chain/index.js";
import { getStore } from "../src/store/index.js";
import { runMonitorTick } from "../src/monitor/index.js";
import { subscribeOps } from "../src/observability/opsBus.js";
import type { OpsEvent } from "../src/observability/opsBus.js";

// ── Shared helpers ───────────────────────────────────────────────────────────

const TOKEN = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

/** A chain where EVERY send/buyback fails, so all settlement legs return false
 *  (INCOMPLETE) on every tick — the position never settles. */
class AlwaysFailChain implements ChainAdapter {
  getWalletAddress(): string {
    return "0x7ad1e9c0d4b3a2f1e8d7c6b5a4938271605f4e3d";
  }
  async getWalletBalanceEth(): Promise<number> {
    return 1.5;
  }
  async buy(_address: string, amountInEth: number): Promise<SwapResult> {
    return { txHash: "0xbuy", amountOut: amountInEth / 1e-8, priceEth: 1e-8 };
  }
  async sell(): Promise<SwapResult> {
    // Return profit so the position reaches the settle() call.
    return { txHash: "0xsell", amountOut: 0.5, priceEth: 1e-6 };
  }
  async getTokenPriceEth(): Promise<number> {
    return 1e-6;
  }
  async quoteSell(): Promise<{ proceedsEth: number }> {
    return { proceedsEth: 0.5 };
  }
  async sendEth(_toAddress: string, _amountEth: number): Promise<string> {
    throw new Error("AlwaysFailChain: sendEth always fails");
  }
  async buybackAndBurn(): Promise<{ txHash: string; tokensBurned: number }> {
    throw new Error("AlwaysFailChain: buybackAndBurn always fails");
  }
}

/** A position primed to close on the first monitor tick. Mirrors settle-retry.test.ts. */
function primedToClose(id: string, authorXId = `${id}-author`): Position {
  return {
    id,
    postId: `${id}-post`,
    authorXId,
    authorHandle: "@winner",
    postUrl: `https://x.com/winner/status/${id}`,
    order: {
      contractAddress: TOKEN,
      chain: "base",
      amountInEth: 0.1,
      takeProfits: [{ priceX: 2, sellFraction: 1 }],
      stopLossX: 0.7,
    },
    status: "open",
    entryPriceEth: 1e-8,
    entryTxHash: "0xentry",
    remainingFraction: 1,
    tiersHit: 0,
    realisedPnlEth: 0,
    openedAt: new Date().toISOString(),
  };
}

/** Collect ops events published during `fn()`. */
async function captureOps(fn: () => Promise<void>): Promise<OpsEvent[]> {
  const events: OpsEvent[] = [];
  const unsub = subscribeOps((e) => events.push(e));
  try {
    await fn();
  } finally {
    unsub();
  }
  return events;
}

// ── G6a — settlePosition throws → settle:failed ops emitted ─────────────────
// HONEST GAP: every throw path inside settlePosition/runEndowment is caught by
// runLeg() or payAuthorDirect() — there is no reachable code path that causes
// settlePosition itself to throw without a store injection seam that doesn't
// yet exist (store singleton is module-private, no __setStoreForTest exported).
// GREEN must either export a store seam OR wrap the settle() call differently.
test.skip("G6a: settlePosition throws → settle:failed ops event published (honest gap — store seam needed)", () => {
  // Document the gap explicitly rather than writing a false-green test.
  // This test will pass as a skip; the actual RED test requires a store seam.
  // When GREEN is implemented, remove this skip and add a real assertion.
  // Tracked in logging-gaps.md G6.
});

// ── G6a-throw: PR-review RED — settle() THREW branch emits settle:failed ────
// The monitor/index.ts settle() has a THREW catch block (catches errors thrown
// by settlePosition itself). That branch calls log.error but does NOT emit a
// settle:failed OpsEvent. This test documents the missing publish.
//
// HONEST GAP: settlePosition cannot be made to throw via external injection
// without a __setSettlePositionForTest seam (settlePosition is module-private
// in pipeline/index.ts and is imported directly into monitor/index.ts). No
// such seam exists today. Forcing a throw would require modifying src files,
// which is out of scope for the RED phase.
//
// The skip below pins the gap explicitly. When GREEN adds a settlePosition
// injection seam, replace this skip with an active assertion.
test.skip(
  "G6a-throw: settle() THREW branch emits settle:failed ops event (honest gap: settlePosition throw not injectable)",
  async () => {
    // To implement this test when GREEN lands:
    //   1. Export __setSettlePositionForTest(fn) from monitor/index.ts (or pipeline)
    //   2. Inject a settlePosition stub that throws new Error("forced throw")
    //   3. Drive the monitor tick with a position primed to close (like G6c above)
    //   4. Assert ops.some(e => e.type === "settle:failed") is true
    //   5. Assert the settle:failed event carries positionId + reason mentioning "threw"
    assert.fail("not implemented — store/settle seam absent");
  },
);

// ── G6b — settlePosition returns null despite profit > 0 → settle:failed ────
// HONEST GAP: runEndowment returns null only when profitEth <= 0, but monitor's
// settle() guards `if (pos.realisedPnlEth <= 0) return null` before calling
// settlePosition — so the null branch at monitor:445 is unreachable via any
// externally-injectable failure. GREEN must either add a mock seam for
// settlePosition or restructure the guard so the null branch has a test path.
test.skip("G6b: settlePosition returns null → settle:failed ops event published (honest gap — no injectable null path)", () => {
  // Document the gap explicitly. The null branch is reserved for an internal
  // invariant violation that cannot be triggered from the outside today.
  // Tracked in logging-gaps.md G6.
});

// ── G6c — INCOMPLETE settlement → settle:failed ops emitted ─────────────────
// Drives the monitor INCOMPLETE branch: all payout legs fail (AlwaysFailChain),
// the position closes but no leg marks done → settle() hits the
// `!(authorDone && buybackDone)` guard and logs log.error.
// GREEN must publish a `settle:failed` ops event in that branch.
test("G6c: INCOMPLETE settlement emits settle:failed ops event", async () => {
  const store = getStore();
  const id = "pos-obs-incomplete";

  // No wallet on file → author leg goes to escrow (avoids payAuthorDirect which
  // has its own send, keeping the failure surface clean). AlwaysFailChain still
  // fails the team + buyback sends, leaving all three legs undone.
  const chain = new AlwaysFailChain();
  __setChainForTest(chain);
  try {
    await store.savePosition(primedToClose(id, `${id}-no-wallet`));

    const ops = await captureOps(() => runMonitorTick());

    // The monitor's INCOMPLETE branch (monitor/index.ts settle()) should emit a
    // single settle:failed event that SUMMARISES which legs are still pending —
    // its reason must mention leg completion flags (e.g. "author=... team=...
    // buyback=..."). This is DISTINCT from per-leg settle:failed events emitted
    // by runLeg() (those carry on-chain error messages, not a flags summary).
    const monitorIncompleteEvents = ops.filter(
      (e): e is Extract<OpsEvent, { type: "settle:failed" }> =>
        e.type === "settle:failed" &&
        // Monitor summary reason includes completion-flag format
        /author=/.test(e.reason) &&
        /team=/.test(e.reason) &&
        /buyback=/.test(e.reason),
    );

    assert.equal(
      monitorIncompleteEvents.length,
      1,
      `Expected 1 settle:failed ops event from the monitor INCOMPLETE branch for ${id}, ` +
        `got ${monitorIncompleteEvents.length}. ` +
        `GREEN: monitor/index.ts settle() INCOMPLETE branch must call ` +
        `publishOps({type:"settle:failed", positionId, reason:"author=... team=... buyback=..."}).`,
    );

    const ev = monitorIncompleteEvents[0];
    assert.equal(ev.positionId, id, "settle:failed event must carry the positionId");
    assert.ok(
      /author=/.test(ev.reason) && /team=/.test(ev.reason) && /buyback=/.test(ev.reason),
      `reason must name leg completion flags, got: "${ev.reason}"`,
    );
  } finally {
    __setChainForTest(null);
  }
});

// ── G4 — orphaned pending-buy → error ops event per orphan ──────────────────
// reconcilePendingBuys() is module-private in service.ts (not exported).
// The dynamic import below will fail at runtime with SyntaxError/TypeError
// because the named export does not exist — that IS the RED signal.
// GREEN must: (1) export reconcilePendingBuys from service.ts, AND
//             (2) emit publishOps({type:"error",...}) for each orphan.
test("G4: reconcilePendingBuys emits error ops event per orphaned pending-buy", async () => {
  const store = getStore();

  // Attempt to import the (currently unexported) reconcilePendingBuys.
  // This will throw "does not provide an export named 'reconcilePendingBuys'"
  // in RED; in GREEN it will resolve and the assertions below will run.
  const serviceModule = await import("../src/service.js") as Record<string, unknown>;
  const reconcilePendingBuys = serviceModule["reconcilePendingBuys"] as
    | (() => Promise<void>)
    | undefined;

  assert.ok(
    typeof reconcilePendingBuys === "function",
    "reconcilePendingBuys must be exported from service.ts — GREEN: export async function reconcilePendingBuys()",
  );

  // Seed two orphaned pending-buy markers (no corresponding Position saved).
  await store.recordPendingBuy({
    postId: "orphan-post-1",
    contractAddress: "0xaaaa000000000000000000000000000000000001",
    amountInEth: 0.05,
    at: new Date().toISOString(),
  });
  await store.recordPendingBuy({
    postId: "orphan-post-2",
    contractAddress: "0xbbbb000000000000000000000000000000000002",
    amountInEth: 0.1,
    at: new Date().toISOString(),
  });

  const ops = await captureOps(() => reconcilePendingBuys!());

  const errorEvents = ops.filter(
    (e): e is Extract<OpsEvent, { type: "error" }> => e.type === "error",
  );

  assert.equal(
    errorEvents.length,
    2,
    `Expected 2 error ops events (one per orphan), got ${errorEvents.length}. ` +
      `GREEN: service.ts reconcilePendingBuys() must call publishOps({type:"error",...}) per orphan.`,
  );

  const msgs = errorEvents.map((e) => e.msg);
  assert.ok(
    msgs.some((m) => m.includes("0xaaaa000000000000000000000000000000000001")),
    "error ops msg must name the contract address of orphan 1",
  );
  assert.ok(
    msgs.some((m) => m.includes("0xbbbb000000000000000000000000000000000002")),
    "error ops msg must name the contract address of orphan 2",
  );
  assert.ok(
    msgs.some((m) => m.includes("orphan-post-1")),
    "error ops msg must name the postId of orphan 1",
  );
  assert.ok(
    msgs.some((m) => m.includes("orphan-post-2")),
    "error ops msg must name the postId of orphan 2",
  );
});
