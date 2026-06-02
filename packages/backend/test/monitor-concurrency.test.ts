/**
 * PR2 — concurrency safety in the monitor.
 *
 * The live bug: two overlapping monitor ticks (setInterval fires the next tick
 * before the previous finishes, OR a manual close races the monitor) both read
 * the same open position, both run it to the final take-profit tier, and both
 * call settle() — paying the author 25% TWICE and double-running the buyback.
 *
 * These tests fire two monitor ticks CONCURRENTLY against one position that is
 * primed to close on the next tick, and assert it settles EXACTLY ONCE. Both
 * exit paths are covered, because both run the same settle() and both moved
 * real money in the live bug:
 *   1. TAKE-PROFIT — entry far below the final tier (the original PR2 repro).
 *   2. STOP-LOSS   — a profitable trailing stop-out (entry above the mock price
 *      with a tier already banked); the SL path funnels through closeOutWithKind
 *      → settle(), so it must be guarded by the same lock.
 *
 * Before the fix (no mutex around the tick) → 2 distributions (RED).
 * After  the fix (withLock serializes the tick) → 1 distribution (GREEN).
 */

import "./helpers/isolate-store.js"; // MUST be first — temp DATA_DIR + mock mode
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "@thesis/shared";
import { getStore } from "../src/store/index.js";
import { runMonitorTick } from "../src/monitor/index.js";

/** An open position with a SINGLE take-profit tier the mock price already
 *  exceeds. One tier ⇒ exactly one `await sell` before the position closes and
 *  settles — so two concurrent ticks both pass the "is it open?" check and both
 *  reach settle(), deterministically double-settling without the fix. */
function primedToClose(id: string): Position {
  return {
    id,
    postId: `${id}-post`,
    authorXId: `${id}-author`,
    authorHandle: "@winner",
    postUrl: `https://x.com/winner/status/${id}`,
    order: {
      contractAddress: "0xabcabcabcabcabcabcabcabcabcabcabcabcabca",
      chain: "base",
      amountInEth: 0.1,
      // ONE tier, sells the whole position. Mock price ~2e-7..2e-6 vs entry
      // 1e-8 ⇒ ≥20× ⇒ well past the +100% (2×) trigger on the first tick.
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

test("two concurrent monitor ticks settle a position exactly once", async () => {
  const store = getStore();
  const pos = primedToClose("pos-concurrent-settle");
  await store.savePosition(pos);

  // Fire two ticks at the same time — they interleave on every await.
  await Promise.all([runMonitorTick(), runMonitorTick()]);

  const dists = (await store.getDistributions()).filter(
    (d) => d.positionId === pos.id,
  );
  assert.equal(
    dists.length,
    1,
    `position must settle exactly once — got ${dists.length} distributions`,
  );

  const all = await store.getAllPositions();
  const closed = all.find((p) => p.id === pos.id);
  assert.equal(closed?.status, "closed", "position should be closed");
});

/** An open position primed to STOP OUT in profit on the next tick. entry 1e-5
 *  sits ABOVE the mock price (≤2e-6), so price ≤ stopPrice = entry·milestoneX·
 *  stopLossX = 1e-5·2·0.7 = 1.4e-5 and the trailing stop trips. tiersHit:1 sets
 *  milestoneX to the first tier (2×) — the trailing stop is above entry — and a
 *  banked realisedPnlEth keeps total PnL > 0 through the (small) remainder loss,
 *  so settle() runs and records a distribution to count. Without the lock both
 *  ticks would stopOut + settle, double-paying the author. */
function primedToStopOut(id: string): Position {
  return {
    id,
    postId: `${id}-post`,
    authorXId: `${id}-author`,
    authorHandle: "@winner",
    postUrl: `https://x.com/winner/status/${id}`,
    order: {
      contractAddress: "0xdef0def0def0def0def0def0def0def0def0def0",
      chain: "base",
      amountInEth: 0.1,
      takeProfits: [{ priceX: 2, sellFraction: 0.5 }],
      stopLossX: 0.7,
    },
    status: "open",
    entryPriceEth: 1e-5,
    entryTxHash: "0xentry",
    remainingFraction: 0.5, // first tier already sold half
    tiersHit: 1, // ⇒ trailing stop = entry·2·0.7 = 1.4e-5, above entry
    realisedPnlEth: 1.0, // banked from the fired tier — keeps total PnL > 0
    openedAt: new Date().toISOString(),
  };
}

test("two concurrent ticks settle a STOP-LOSS close exactly once", async () => {
  const store = getStore();
  const pos = primedToStopOut("pos-sl-concurrent-settle");
  await store.savePosition(pos);

  await Promise.all([runMonitorTick(), runMonitorTick()]);

  const dists = (await store.getDistributions()).filter(
    (d) => d.positionId === pos.id,
  );
  assert.equal(
    dists.length,
    1,
    `stop-loss must settle exactly once — got ${dists.length} distributions`,
  );

  const all = await store.getAllPositions();
  const closed = all.find((p) => p.id === pos.id);
  assert.equal(closed?.status, "closed", "stopped-out position should be closed");
});
