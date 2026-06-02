/**
 * Money-safety — the monitor must NEVER fire a take-profit on a position with
 * no valid entry baseline (entryPriceEth <= 0).
 *
 * Incident this pins — 2026-06-02 $HESTIA (0x1bf2…8ba3):
 *   buy() recorded entryPriceEth from a PRE-TRADE oracle read. For a fresh
 *   Clanker/Bankr launch Birdeye hadn't indexed yet, that read returned 0, so
 *   the position's entryPriceEth was 0. On the next monitor tick the tier test
 *   `price >= entryPriceEth × tierX` became `price >= 0` — TRUE for every tier —
 *   so all four take-profits (TP1..TP4: +100/+200/+300/+1000%) "hit" at once and
 *   the position force-closed on a token that NEVER MOVED, announcing phantom
 *   wins and running settlement. It happened twice on the same token (two posts).
 *
 * buy() now records the real execution price (ETH in / tokens out — see
 * entryPriceEthFromFill), so a fresh buy can't be 0. This test pins the monitor's
 * BACKSTOP for any legacy/corrupt row: a 0 baseline fires NOTHING, sells nothing,
 * settles nothing, and the position stays open for an operator to repair.
 *
 * Before the guard → 4 tiers fire, status "closed", a distribution recorded (RED).
 * After  the guard → 0 tiers, status "open", no distribution (GREEN).
 */

import "./helpers/isolate-store.js"; // MUST be first — temp DATA_DIR + mock mode
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "@thesis/shared";
import { getStore } from "../src/store/index.js";
import { runMonitorTick } from "../src/monitor/index.js";

/** An open position stamped with the bug's entryPriceEth=0 and the production
 *  4-tier ladder. The mock price feed returns a POSITIVE price (~2e-7..2e-6) for
 *  any address, so `price >= 0 × tierX` would fire every tier without the guard. */
function zeroEntryPosition(id: string): Position {
  return {
    id,
    postId: `${id}-post`,
    authorXId: `${id}-author`,
    authorHandle: "@phantom",
    postUrl: `https://x.com/phantom/status/${id}`,
    order: {
      contractAddress: "0x1bf2e83c7bc58b5b1aef3d6c953424c2361f8ba3",
      chain: "base",
      amountInEth: 0.025,
      // The live ladder: TP1 +100%/50%, TP2 +200%/25%, TP3 +300%/15%, TP4 +1000%/10%.
      takeProfits: [
        { priceX: 2, sellFraction: 0.5 },
        { priceX: 3, sellFraction: 0.25 },
        { priceX: 4, sellFraction: 0.15 },
        { priceX: 11, sellFraction: 0.1 },
      ],
      stopLossX: 0.7,
    },
    status: "open",
    entryPriceEth: 0, // ← the bug: oracle returned 0 for a not-yet-indexed fresh launch
    entryTokens: 98_535_939,
    entryTxHash: "0xentry",
    remainingFraction: 1,
    tiersHit: 0,
    realisedPnlEth: 0,
    openedAt: new Date().toISOString(),
  };
}

test("monitor fires NO take-profit tier when entryPriceEth is 0 (phantom-TP guard)", async () => {
  const store = getStore();
  const pos = zeroEntryPosition("pos-phantom-tp");
  await store.savePosition(pos);

  await runMonitorTick();

  const after = (await store.getAllPositions()).find((p) => p.id === pos.id);
  assert.equal(after?.status, "open", "position must stay OPEN — no tier may fire on a 0 baseline");
  assert.equal(after?.tiersHit, 0, "no take-profit tier may fire against entryPriceEth=0");
  assert.equal(after?.remainingFraction, 1, "nothing should have been sold");
  assert.equal(after?.realisedPnlEth, 0, "no phantom profit should be booked");

  const dists = (await store.getDistributions()).filter((d) => d.positionId === pos.id);
  assert.equal(dists.length, 0, "a phantom close must not settle or pay the author");
});
