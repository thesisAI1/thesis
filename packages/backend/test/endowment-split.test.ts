/**
 * Tier A — Endowment settlement split (agents/endowment.ts:runEndowment).
 *
 * A winning trade's realised profit is split 25/50/25:
 *   author · portfolio (stays in wallet) · buyback.
 * These pin the money math that decides how much real ETH each leg moves:
 *   - not in profit            → no settlement (null)
 *   - quarters sum to the whole, author paid directly when a wallet is on file
 *   - no wallet on file         → escrowed, cumulative across closes
 *
 * runEndowment is called directly with an injected recording chain so we can
 * assert exactly what each leg moves.
 */

import "./helpers/isolate-store.js"; // temp DATA_DIR + mock mode before config loads
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "@thesis/shared";
import type { ChainAdapter, SwapResult } from "../src/adapters/chain/index.js";
import { __setChainForTest } from "../src/adapters/chain/index.js";
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

test("endowment: profit splits 25/50/25 and pays a known author wallet directly", async () => {
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
    assert.equal(d.toPortfolioEth, 0.5);
    assert.equal(d.toBuybackEth, 0.25);
    assert.equal(
      d.toAuthorEth + d.toPortfolioEth + d.toBuybackEth,
      1.0,
      "the three legs must sum to the whole profit",
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

test("endowment: with no wallet on file the author's share is escrowed, cumulatively", async () => {
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
    // With the author escrowed (not sent) and the portfolio quarter staying in
    // the wallet, the only on-chain money movement is the buyback leg — which
    // goes through buybackAndBurn, never sendEth. So no sendEth at all.
    assert.equal(chain.sends.length, 0, "author escrowed + portfolio retained → no sendEth; buyback uses buybackAndBurn");
  } finally {
    __setChainForTest(null);
  }
});
