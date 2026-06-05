/**
 * Money-safety — a take-profit tier must be CONFIRMED realizable on-chain
 * (via quoteSell) before it fires. A thin/manipulated pool can print a phantom
 * price spike on the feed that is not actually realizable; firing on it dumps
 * the whole bag at a loss.
 *
 * Incident this pins — 2026-06-05 $ZERO (Solana):
 *   the token was bought through a near-empty Meteora LP. That tiny pool printed
 *   a fake ~1M× price on the DexScreener feed. The monitor saw price ≥ every
 *   tier threshold and fired TP1..TP4 at once, selling the entire position into
 *   the real (low) LP — a phantom "4 take-profits" that closed at a LOSS.
 *
 * Defence pinned here: before selling a tier, the monitor asks the chain for an
 * independent quoteSell. The phantom feed price isn't realizable, so the quote
 * comes back far below the tier's implied exit and NO tier fires. The position
 * stays open, nothing is sold, nothing is settled.
 *
 * Before the gate → 4 tiers fire, bag dumped, status "closed" (RED).
 * After  the gate → 0 tiers, nothing sold, status "open" (GREEN).
 */

import "./helpers/isolate-store.js"; // MUST be first — temp DATA_DIR + mock mode

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "@thesis/shared";
import { getStore } from "../src/store/index.js";
import { runMonitorTick } from "../src/monitor/index.js";
import { __setBaseDataForTest } from "../src/adapters/basedata/index.js";
import { __setChainForTest } from "../src/adapters/chain/index.js";
import type { BaseDataAdapter, TokenOnChain } from "../src/adapters/basedata/index.js";
import type { ChainAdapter, SwapResult } from "../src/adapters/chain/index.js";

afterEach(() => {
  __setBaseDataForTest(null);
  __setChainForTest(null);
});

const ADDR = "0xphantomphantomphantomphantomphantom0001";
const ENTRY_PRICE = 1e-6; // real, low price the bag is actually worth
const PHANTOM_PRICE = ENTRY_PRICE * 1_000_000; // fake ~1M× spike on the feed

/** Feed reports the phantom spike — clears every tier threshold. */
function phantomFeed(): BaseDataAdapter {
  return {
    async getToken(_a: string): Promise<TokenOnChain> {
      return {
        contractAddress: _a,
        chain: "base",
        priceEth: PHANTOM_PRICE,
        liquidityUsd: 0,
        marketCapUsd: 0,
        launchedAt: new Date().toISOString(),
        launchpad: null,
        isHoneypot: false,
        topHolders: [],
      };
    },
    async getPriceEth(_a: string): Promise<number> { return PHANTOM_PRICE; },
    async getPricesEth(addrs: string[]): Promise<Map<string, number>> {
      return new Map(addrs.map((a) => [a.toLowerCase(), PHANTOM_PRICE]));
    },
    async getTokenSymbol(_a: string): Promise<string> { return "ZERO"; },
  };
}

/** Chain whose quoteSell reflects the REAL (low) realizable price, and which
 *  records any sell so we can assert none happened. */
function realizableChain(): ChainAdapter & { sells: number } {
  const adapter = {
    sells: 0,
    getWalletAddress(): string { return "0xWALLET"; },
    async getWalletBalanceEth(): Promise<number> { return 1.0; },
    async buy(_a: string, amountInEth: number): Promise<SwapResult> {
      return { txHash: "0xBUY", amountOut: amountInEth / ENTRY_PRICE, priceEth: ENTRY_PRICE };
    },
    async sell(_a: string, amountTokens: number): Promise<SwapResult> {
      adapter.sells += 1;
      return { txHash: "0xSELL", amountOut: amountTokens * ENTRY_PRICE, priceEth: ENTRY_PRICE };
    },
    async getTokenPriceEth(_a: string): Promise<number> { return ENTRY_PRICE; },
    async quoteSell(_a: string, amountTokens: number): Promise<{ proceedsEth: number }> {
      // The phantom feed price is NOT realizable — the live LP only yields the
      // real (low) price.
      return { proceedsEth: amountTokens * ENTRY_PRICE };
    },
    async sendEth(_to: string, _amt: number): Promise<string> { return "0xSEND"; },
    async buybackAndBurn(_amt: number): Promise<{ txHash: string; tokensBurned: number }> {
      return { txHash: "0xBURN", tokensBurned: 0 };
    },
  };
  return adapter;
}

function phantomSpikePosition(id: string): Position {
  return {
    id,
    postId: `${id}-post`,
    authorXId: `${id}-author`,
    authorHandle: "@zero",
    postUrl: `https://x.com/zero/status/${id}`,
    order: {
      contractAddress: ADDR,
      chain: "base",
      amountInEth: 0.02,
      takeProfits: [
        { priceX: 2, sellFraction: 0.5 },
        { priceX: 3, sellFraction: 0.25 },
        { priceX: 4, sellFraction: 0.15 },
        { priceX: 11, sellFraction: 0.1 },
      ],
      stopLossX: 0.7,
    },
    status: "open",
    entryPriceEth: ENTRY_PRICE,
    entryTokens: 0.02 / ENTRY_PRICE,
    entryTxHash: "0xentry",
    remainingFraction: 1,
    tiersHit: 0,
    realisedPnlEth: 0,
    openedAt: new Date().toISOString(),
  };
}

test("monitor fires NO tier on a phantom feed spike that quoteSell cannot realize", async () => {
  __setBaseDataForTest(phantomFeed());
  const chain = realizableChain();
  __setChainForTest(chain);

  const store = getStore();
  const pos = phantomSpikePosition("pos-tp-confirm");
  await store.savePosition(pos);

  await runMonitorTick();

  const after = (await store.getAllPositions()).find((p) => p.id === pos.id);
  assert.equal(after?.status, "open", "position must stay OPEN — the spike is not realizable");
  assert.equal(after?.tiersHit, 0, "no tier may fire on an unconfirmable phantom spike");
  assert.equal(after?.remainingFraction, 1, "nothing should have been sold");
  assert.equal(after?.realisedPnlEth, 0, "no phantom profit should be booked");
  assert.equal(chain.sells, 0, "the chain sell path must never be reached for a phantom spike");

  const dists = (await store.getDistributions()).filter((d) => d.positionId === pos.id);
  assert.equal(dists.length, 0, "a phantom close must not settle or pay the author");
});
