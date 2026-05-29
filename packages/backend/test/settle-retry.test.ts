/**
 * PR3 — durable, idempotent settlement (the "author never paid" fix).
 *
 * The live bug: when a position fully closes in profit, the monitor marks it
 * `closed` and runs settle() ONCE. If a payout leg fails — `payAuthorDirect`
 * catches a failed `sendEth` and returns {kind:"failed"} without throwing, or a
 * later leg throws — the position is already `closed`, `getOpenPositions()` never
 * returns it again, and nothing retries. The author is never paid (the close
 * tweet literally says "will retry" but nothing does).
 *
 * The fix: each settlement leg is gated on a persisted marker; the monitor
 * retries closed-but-unsettled positions every tick, re-running ONLY the legs
 * that have not yet succeeded. So a transient failure is recovered AND no leg is
 * ever paid twice.
 *
 * This test fails the first sends (author + team) on tick 1, then lets them
 * succeed on tick 2, and asserts: settled only after the retry, author paid
 * EXACTLY once, buyback run EXACTLY once (not re-run), one distribution.
 *
 * RED (pre-fix): no `settledAt` / `getUnsettledClosedPositions` / retry pass —
 * the position settles "successfully" on tick 1 with the author unpaid, and is
 * never revisited. GREEN (post-fix): author is paid on the retry, once.
 */

import "./helpers/isolate-store.js"; // MUST be first — temp DATA_DIR + mock mode
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "@thesis/shared";
import type { ChainAdapter, SwapResult } from "../src/adapters/chain/index.js";
import { __setChainForTest } from "../src/adapters/chain/index.js";
import { config } from "../src/config.js";
import { getStore } from "../src/store/index.js";
import { runMonitorTick } from "../src/monitor/index.js";

const AUTHOR_WALLET = "0xa11ce0000000000000000000000000000000a11e";
const TOKEN = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

/** A chain whose `sendEth` throws on its first `failSends` calls (a transient
 *  RPC outage), then succeeds. Counts successful sends per recipient and total
 *  buyback calls so the test can prove each paying leg ran exactly once. */
class FlakyChain implements ChainAdapter {
  private sendCalls = 0;
  readonly okSendsByTo = new Map<string, number>();
  buybackCalls = 0;
  constructor(private readonly failSends: number) {}

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
    // Return more ETH than the slice cost (0.1) so the close is in profit.
    return { txHash: "0xsell", amountOut: 0.5, priceEth: 1e-6 };
  }
  async getTokenPriceEth(): Promise<number> {
    return 1e-6;
  }
  async sendEth(toAddress: string, _amountEth: number): Promise<string> {
    this.sendCalls += 1;
    if (this.sendCalls <= this.failSends) {
      throw new Error(`RPC down (send #${this.sendCalls})`);
    }
    this.okSendsByTo.set(toAddress, (this.okSendsByTo.get(toAddress) ?? 0) + 1);
    return `0xsend${this.sendCalls}`;
  }
  async buybackAndBurn(): Promise<{ txHash: string; tokensBurned: number }> {
    this.buybackCalls += 1;
    return { txHash: "0xburn", tokensBurned: 1 };
  }
}

/** An open position the mock price already clears on the first tick (one tier,
 *  sells 100%) — so one tick closes it and reaches settle(). */
function primedToClose(id: string): Position {
  return {
    id,
    postId: `${id}-post`,
    authorXId: `${id}-author`,
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

test("a failed settlement is retried and settles exactly once (no double-pay)", async () => {
  const lotteryWas = config.holderLottery.enabled;
  // Disable the lottery so the team slice is one simple sendEth (the leg we fail
  // on tick 1), not holder enumeration.
  (config.holderLottery as { enabled: boolean }).enabled = false;

  const store = getStore();
  const id = "pos-settle-retry";
  // Author has a payout wallet on file → DIRECT payout via sendEth (the failing leg).
  await store.linkWallet({
    xUserId: `${id}-author`,
    handle: "@winner",
    wallet: AUTHOR_WALLET,
    linkedAt: new Date().toISOString(),
  });

  // Fail the first two sends (author + team on tick 1); they succeed afterwards.
  const chain = new FlakyChain(2);
  __setChainForTest(chain);
  try {
    await store.savePosition(primedToClose(id));

    // --- Tick 1: closes, but author + team sends THROW → settlement incomplete.
    await runMonitorTick();
    let fresh = (await store.getAllPositions()).find((p) => p.id === id);
    assert.equal(fresh?.status, "closed", "position should be closed after tick 1");
    assert.equal(
      fresh?.settledAt,
      undefined,
      "must NOT be marked settled while a payout leg failed",
    );
    assert.equal(
      (await store.getDistributions()).filter((d) => d.positionId === id).length,
      0,
      "no distribution should be recorded for an incomplete settlement",
    );
    assert.equal(
      chain.okSendsByTo.get(AUTHOR_WALLET) ?? 0,
      0,
      "author was not actually paid on tick 1 (the send threw)",
    );

    // --- Tick 2: the monitor's resume pass retries — sends now succeed, and the
    // buyback (already done on tick 1) is SKIPPED → settles exactly once.
    await runMonitorTick();
    fresh = (await store.getAllPositions()).find((p) => p.id === id);
    assert.ok(fresh?.settledAt, "position must be settled after the retry");
    assert.equal(
      chain.okSendsByTo.get(AUTHOR_WALLET),
      1,
      "author must be paid EXACTLY once across both ticks (no double-pay)",
    );
    assert.equal(
      chain.buybackCalls,
      1,
      "buyback must run exactly once — not re-run on the retry",
    );
    assert.equal(
      (await store.getDistributions()).filter((d) => d.positionId === id).length,
      1,
      "exactly one distribution after the position settles",
    );

    // --- Tick 3: a settled position is never reconsidered (terminal).
    await runMonitorTick();
    assert.equal(
      chain.okSendsByTo.get(AUTHOR_WALLET),
      1,
      "a settled position must never pay the author again",
    );
    assert.equal(chain.buybackCalls, 1, "a settled position must never buy back again");
  } finally {
    __setChainForTest(null);
    (config.holderLottery as { enabled: boolean }).enabled = lotteryWas;
  }
});
