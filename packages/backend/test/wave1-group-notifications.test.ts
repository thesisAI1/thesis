/**
 * Wave 1 — Telegram group-notifications feature, TDD RED → GREEN.
 *
 * Tests:
 *   W1a: payout:sent emitted on direct author payout success
 *   W1b: settle:summary emitted exactly once when settlement fully completes (via runMonitorTick)
 */

import "./helpers/isolate-store.js"; // MUST be first
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "@thesis/shared";
import type { ChainAdapter, SwapResult } from "../src/adapters/chain/index.js";
import { __setChainForTest } from "../src/adapters/chain/index.js";
import { subscribeOps, type OpsEvent } from "../src/observability/opsBus.js";
import { getStore } from "../src/store/index.js";
import { runEndowment } from "../src/agents/endowment.js";
import { runMonitorTick } from "../src/monitor/index.js";
import { config } from "../src/config.js";

// ── Chain adapter ─────────────────────────────────────────────────────────────

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
    return { txHash: "0xsell", amountOut: 0.5, priceEth: 1e-6 };
  }
  async quoteSell(): Promise<{ proceedsEth: number }> {
    return { proceedsEth: 0.5 };
  }
  async getTokenPriceEth(): Promise<number> {
    return 1e-6;
  }
  async sendEth(_to: string, _amt: number): Promise<string> {
    return "0xpayoutsend";
  }
  async buybackAndBurn(_amt: number): Promise<{ txHash: string; tokensBurned: number }> {
    return { txHash: "0xburn", tokensBurned: 1 };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function withLottery(enabled: boolean, fn: () => Promise<void>): Promise<void> {
  const prev = config.holderLottery.enabled;
  (config.holderLottery as { enabled: boolean }).enabled = enabled;
  return fn().finally(() => {
    (config.holderLottery as { enabled: boolean }).enabled = prev;
  });
}

function makeClosedPosition(opts: { id: string; authorXId: string }): Position {
  return {
    id: opts.id,
    postId: `${opts.id}-post`,
    authorXId: opts.authorXId,
    authorHandle: "@w1author",
    postUrl: `https://x.com/w1author/status/${opts.id}`,
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
    remainingFraction: 0,
    tiersHit: 1,
    realisedPnlEth: 1.0,
    openedAt: new Date().toISOString(),
  };
}

/** Position primed to close on the first monitor tick (mirrors settle-retry.test.ts). */
function primedToClose(id: string, authorXId = `${id}-author`): Position {
  return {
    id,
    postId: `${id}-post`,
    authorXId,
    authorHandle: "@w1author",
    postUrl: `https://x.com/w1author/status/${id}`,
    order: {
      contractAddress: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
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

// ── W1a: payout:sent emitted on direct author payout success ─────────────────

test("W1a: payAuthorDirect success emits payout:sent ops event", async () => {
  const store = getStore();
  const authorXId = "w1a-author";
  const wallet = "0xA1Ace00000000000000000000000000000001A1A";
  await store.linkWallet({
    xUserId: authorXId,
    handle: "@w1author",
    wallet,
    linkedAt: new Date().toISOString(),
  });

  await withLottery(false, async () => {
    const chain = new NormalChain();
    __setChainForTest(chain);
    try {
      const ops = await collectOps(() =>
        runEndowment(
          makeClosedPosition({ id: "w1a-pos", authorXId }),
          1.0,
          { silentAuthorTweet: true },
        ).then(() => undefined),
      );

      const payoutSent = ops.filter((e) => e.type === "payout:sent");
      assert.ok(
        payoutSent.length >= 1,
        `Expected at least one payout:sent ops event, got: [${ops.map((e) => e.type).join(", ")}]`,
      );
      const ev = payoutSent[0];
      assert.equal(ev.type, "payout:sent");
      if (ev.type === "payout:sent") {
        assert.ok(
          ev.handle === "@w1author" || ev.handle === authorXId,
          `payout:sent handle must identify the author, got: ${ev.handle}`,
        );
        assert.ok(ev.amountEth > 0, `payout:sent amountEth must be > 0, got: ${ev.amountEth}`);
        assert.ok(ev.wallet.length > 0, `payout:sent wallet must be non-empty, got: "${ev.wallet}"`);
        assert.ok(ev.txHash.length > 0, `payout:sent txHash must be non-empty, got: "${ev.txHash}"`);
      }
    } finally {
      __setChainForTest(null);
    }
  });
});

// ── W1b: settle:summary emitted once when settlement fully completes ──────────
// settle:summary is emitted inside monitor/index.ts (the settle() function),
// so we drive the flow via runMonitorTick + a position primed to close.

test("W1b: complete settlement via monitor emits exactly one settle:summary with direct authorPaid", async () => {
  const store = getStore();
  const id = "w1b-pos";
  const authorXId = "w1b-author";
  const wallet = "0xB1Bce00000000000000000000000000000001B1B";
  await store.linkWallet({
    xUserId: authorXId,
    handle: "@w1author",
    wallet,
    linkedAt: new Date().toISOString(),
  });

  const chain = new NormalChain();
  __setChainForTest(chain);
  try {
    await store.savePosition(primedToClose(id, authorXId));

    const ops = await collectOps(() => runMonitorTick());

    const summaries = ops.filter(
      (e): e is Extract<OpsEvent, { type: "settle:summary" }> =>
        e.type === "settle:summary" && e.positionId === id,
    );

    assert.equal(
      summaries.length,
      1,
      `Expected exactly 1 settle:summary event for position "${id}", got ${summaries.length}. Events: [${ops.map((e) => e.type).join(", ")}]`,
    );

    const ev = summaries[0];
    assert.equal(ev.positionId, id, `settle:summary positionId must be "${id}", got: "${ev.positionId}"`);
    assert.equal(ev.authorPaid, "direct", `settle:summary authorPaid must be "direct" when wallet is linked, got: "${ev.authorPaid}"`);
    assert.ok(ev.totalProfitEth > 0, `settle:summary totalProfitEth must be > 0, got: ${ev.totalProfitEth}`);
    assert.ok(ev.toAuthorEth > 0, `settle:summary toAuthorEth must be > 0, got: ${ev.toAuthorEth}`);
    assert.ok(typeof ev.toPortfolioEth === "number", `settle:summary toPortfolioEth must be present`);
    assert.ok(typeof ev.toTeamEth === "number", `settle:summary toTeamEth must be present`);
    assert.ok(typeof ev.toBuybackEth === "number", `settle:summary toBuybackEth must be present`);
  } finally {
    __setChainForTest(null);
  }
});
