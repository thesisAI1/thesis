/**
 * Tier A — Endowment settlement split (agents/endowment.ts:runEndowment).
 *
 * A winning trade's realised profit is split 25/25/25/25:
 *   author · portfolio (stays in wallet) · team (or holder lottery) · buyback.
 * These pin the money math that decides how much real ETH each leg moves:
 *   - not in profit            → no settlement (null)
 *   - quarters sum to the whole, author paid directly when a wallet is on file
 *   - no wallet on file         → escrowed, cumulative across closes
 *   - undistributed lottery ETH → rolled into the buyback (never sits idle)
 *
 * runEndowment is called directly with an injected recording chain so we can
 * assert exactly what each leg moves. Lottery is toggled per test.
 */

import "./helpers/isolate-store.js"; // temp DATA_DIR + mock mode before config loads
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "@thesis/shared";
import type { ChainAdapter, SwapResult } from "../src/adapters/chain/index.js";
import { __setChainForTest } from "../src/adapters/chain/index.js";
import { config } from "../src/config.js";
import { getStore } from "../src/store/index.js";
import { runEndowment } from "../src/agents/endowment.js";

class RecordingChain implements ChainAdapter {
  readonly sends: { to: string; amountEth: number }[] = [];
  readonly buybacks: number[] = [];
  getWalletAddress(): string {
    return "0x7ad1e9c0d4b3a2f1e8d7c6b5a4938271605f4e3d";
  }
  async getWalletBalanceEth(): Promise<number> {
    return 1.5;
  }
  async buy(_a: string, amountInEth: number): Promise<SwapResult> {
    return { txHash: "0xbuy", amountOut: amountInEth, priceEth: 1 };
  }
  async sell(): Promise<SwapResult> {
    return { txHash: "0xsell", amountOut: 0, priceEth: 1 };
  }
  async getTokenPriceEth(): Promise<number> {
    return 1;
  }
  async sendEth(to: string, amountEth: number): Promise<string> {
    this.sends.push({ to, amountEth });
    return "0xsend";
  }
  async buybackAndBurn(amountInEth: number): Promise<{ txHash: string; tokensBurned: number }> {
    this.buybacks.push(amountInEth);
    return { txHash: "0xburn", tokensBurned: 1 };
  }
}

function position(opts: { id: string; authorXId: string; lastExitTxHash?: string }): Position {
  return {
    id: opts.id,
    postId: `${opts.id}-post`,
    authorXId: opts.authorXId,
    authorHandle: "@author",
    postUrl: `https://x.com/author/status/${opts.id}`,
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

function withLottery(enabled: boolean, fn: () => Promise<void>): Promise<void> {
  const prev = config.holderLottery.enabled;
  (config.holderLottery as { enabled: boolean }).enabled = enabled;
  return fn().finally(() => {
    (config.holderLottery as { enabled: boolean }).enabled = prev;
  });
}

test("endowment: a non-profitable settlement returns null (no payouts)", async () => {
  const chain = new RecordingChain();
  __setChainForTest(chain);
  try {
    assert.equal(await runEndowment(position({ id: "endo-zero", authorXId: "a-zero" }), 0), null);
    assert.equal(await runEndowment(position({ id: "endo-neg", authorXId: "a-neg" }), -0.5), null);
    assert.equal(chain.sends.length, 0, "nothing should move when there is no profit");
  } finally {
    __setChainForTest(null);
  }
});

test("endowment: profit splits 25/25/25/25 and pays a known author wallet directly", async () => {
  await withLottery(false, async () => {
    const store = getStore();
    const authorXId = "a-direct";
    const wallet = "0xA11Ce00000000000000000000000000000000a11";
    await store.linkWallet({ xUserId: authorXId, handle: "@author", wallet, linkedAt: new Date().toISOString() });

    const chain = new RecordingChain();
    __setChainForTest(chain);
    try {
      const result = await runEndowment(position({ id: "endo-direct", authorXId }), 1.0, {
        silentAuthorTweet: true,
      });
      assert.ok(result, "a profitable settlement must return a distribution");
      const d = result.distribution;
      assert.equal(d.toAuthorEth, 0.25);
      assert.equal(d.toPortfolioEth, 0.25);
      assert.equal(d.toTeamEth, 0.25);
      assert.equal(d.toBuybackEth, 0.25);
      assert.equal(
        d.toAuthorEth + d.toPortfolioEth + d.toTeamEth + d.toBuybackEth,
        1.0,
        "the four quarters must sum to the whole profit",
      );
      assert.equal(result.authorPayment.kind, "direct");
      assert.ok(
        chain.sends.some((s) => s.to === wallet && s.amountEth === 0.25),
        "the author's quarter must be sent to their wallet",
      );
      assert.deepEqual(chain.buybacks, [0.25], "the buyback leg gets exactly its quarter");
    } finally {
      __setChainForTest(null);
    }
  });
});

test("endowment: with no wallet on file the author's share is escrowed, cumulatively", async () => {
  await withLottery(false, async () => {
    const store = getStore();
    const authorXId = "a-escrow";
    const chain = new RecordingChain();
    __setChainForTest(chain);
    try {
      // First winning close → quarter escrowed.
      const r1 = await runEndowment(position({ id: "endo-escrow-1", authorXId }), 1.0, {
        silentAuthorTweet: true,
      });
      assert.equal(r1?.authorPayment.kind, "escrowed");
      assert.equal((await store.getEscrow(authorXId))?.amountEth, 0.25);
      assert.equal(r1?.distribution.authorWallet, null, "no wallet on file → distribution records null");

      // Second winning close (different position, same author) → escrow accumulates.
      const r2 = await runEndowment(position({ id: "endo-escrow-2", authorXId }), 1.0, {
        silentAuthorTweet: true,
      });
      assert.equal((await store.getEscrow(authorXId))?.amountEth, 0.5, "escrow must accumulate across closes");
      assert.equal(
        r2?.authorPayment.kind === "escrowed" ? r2.authorPayment.amountEth : -1,
        0.5,
        "the escrow descriptor reports the CUMULATIVE total owed",
      );
      // Across the two closes the only sends are the two team legs (0.25 each);
      // the author leg is escrowed, never a direct sendEth. (4 sends would mean
      // the author was wrongly paid on top of being escrowed.)
      assert.equal(chain.sends.length, 2, "only the team legs send ETH — the author is escrowed, not sent");
    } finally {
      __setChainForTest(null);
    }
  });
});

test("endowment: undistributable lottery ETH is rolled into the buyback (never idle)", async () => {
  await withLottery(true, async () => {
    const store = getStore();
    const authorXId = "a-undist";
    const wallet = "0xA11Ce00000000000000000000000000000000a22";
    await store.linkWallet({ xUserId: authorXId, handle: "@author", wallet, linkedAt: new Date().toISOString() });

    const chain = new RecordingChain();
    __setChainForTest(chain);
    try {
      // No lastExitTxHash → the lottery can't seed a draw → the whole team
      // quarter is "undistributed" and must roll into the buyback budget.
      const result = await runEndowment(position({ id: "endo-undist", authorXId }), 1.0, {
        silentAuthorTweet: true,
      });
      assert.ok(result);
      assert.equal(result.distribution.toTeamEth, 0, "no lottery winners → team leg pays 0");
      assert.equal(
        result.distribution.toBuybackEth,
        0.5,
        "the undistributed team quarter rolls into buyback (0.25 base + 0.25 rolled)",
      );
      assert.deepEqual(chain.buybacks, [0.5], "buyback executes with the topped-up budget");
      assert.equal(result.lotteryPayment?.undistributedEth, 0.25);
    } finally {
      __setChainForTest(null);
    }
  });
});
