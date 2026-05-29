/**
 * PR2 — concurrency safety in the monitor.
 *
 * The live bug: two overlapping monitor ticks (setInterval fires the next tick
 * before the previous finishes, OR a manual close races the monitor) both read
 * the same open position, both run it to the final take-profit tier, and both
 * call settle() — paying the author 25% TWICE and double-running the buyback.
 *
 * This test fires two monitor ticks CONCURRENTLY against one position that is
 * primed to close on the next tick (entry price far below the final tier). It
 * asserts the position settles EXACTLY ONCE.
 *
 * Before the fix (no mutex around the tick) → 2 distributions (RED).
 * After  the fix (withLock serializes the tick) → 1 distribution (GREEN).
 */

import "./helpers/isolate-store.js"; // MUST be first — temp DATA_DIR + mock mode
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "@thesis/shared";
import { config } from "../src/config.js";
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
  // Disable the holder lottery so settlement takes the simple team-wallet leg
  // (no dependency on holder enumeration); we are testing settle-once, not the
  // lottery.
  const lotteryWas = config.holderLottery.enabled;
  (config.holderLottery as { enabled: boolean }).enabled = false;

  const store = getStore();
  const pos = primedToClose("pos-concurrent-settle");
  await store.savePosition(pos);

  try {
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
  } finally {
    (config.holderLottery as { enabled: boolean }).enabled = lotteryWas;
  }
});
