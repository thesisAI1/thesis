/**
 * Phantom unrealised guard — the dashboard must not DISPLAY a Solana gain that
 * isn't realizable on-chain.
 *
 * The live incident (2026-06-05, $ZERO / $peg): a thin/manipulated Solana pool
 * printed a snapshot price tens of × above entry. The min-liquidity floor on the
 * price feed filters near-empty pools, but a pool that fakes its reported
 * liquidity clears it — so getSnapshotsEth returned a phantom-high price and the
 * PUBLIC dashboard rendered a +5950% unrealised on a position that was actually
 * flat. The monitor's TP path already refuses to SELL into that price (it
 * confirms realizable proceeds via quoteSell first); the dashboard didn't apply
 * the same confirmation to what it SHOWS.
 *
 * The fix: for any Solana open position whose snapshot implies a large gain
 * (≥ +100%), confirm the realizable price via quoteSell and never display MORE
 * unrealised than is realizable. A genuine winner (quoteSell ≈ snapshot) is
 * unaffected; a phantom spike is clamped DOWN to the realizable price.
 *
 * RED (pre-fix): the phantom snapshot price flows straight into unrealizedPct →
 * +5900%. GREEN (post-fix): clamped to the realizable (flat) price → ~0%, while
 * the real winner stays high.
 */

import "./helpers/isolate-store.js"; // temp DATA_DIR + mock mode before config loads
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Position } from "@thesis/shared";
import type { BaseDataAdapter, PriceSnapshotEth } from "../src/adapters/basedata/index.js";
import { __setBaseDataForTest } from "../src/adapters/basedata/index.js";
import type { ChainAdapter, SwapResult } from "../src/adapters/chain/index.js";
import { __setChainForTest } from "../src/adapters/chain/index.js";
import { handle, _resetDashboardCacheForTest } from "../src/server/index.js";
import { getStore } from "../src/store/index.js";

function getReq(path: string): IncomingMessage {
  return {
    url: path,
    method: "GET",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;
}

function captureRes(): {
  res: ServerResponse;
  result: () => { status: number; body: unknown };
} {
  let status = 0;
  let body: unknown = null;
  const res = {
    headersSent: false,
    writeHead(s: number) {
      status = s;
      (this as { headersSent: boolean }).headersSent = true;
      return this;
    },
    end(chunk?: string) {
      if (chunk) body = JSON.parse(chunk);
      return this;
    },
  } as unknown as ServerResponse;
  return { res, result: () => ({ status, body }) };
}

const ENTRY = 1e-8;
const ENTRY_TOKENS = 1e7; // bag = 1e7 tokens → remainingCost 0.1 ≈ 1e7 × 1e-8 (flat at entry)

/** An open Solana position primed flat at entry (1e7 tokens cost 0.1 SOL). */
function openSolPosition(id: string, contractAddress: string): Position {
  return {
    id,
    postId: `${id}-post`,
    authorXId: `${id}-author`,
    authorHandle: `@${id}`,
    postUrl: `https://x.com/${id}/status/${id}`,
    order: {
      contractAddress,
      chain: "solana",
      amountInEth: 0.1,
      takeProfits: [{ priceX: 2, sellFraction: 1 }],
      stopLossX: 0.7,
    },
    status: "open",
    entryPriceEth: ENTRY,
    entryTokens: ENTRY_TOKENS,
    entryTxHash: "0xentry",
    remainingFraction: 1,
    tiersHit: 0,
    realisedPnlEth: 0,
    openedAt: new Date().toISOString(),
  };
}

/** Base-data stub: returns whatever snapshot price it's told per address. */
class StubBaseData implements BaseDataAdapter {
  constructor(private readonly priceByAddr: Map<string, number>) {}
  async getToken(): Promise<never> {
    throw new Error("not used");
  }
  async getPriceEth(address: string): Promise<number> {
    return this.priceByAddr.get(address.toLowerCase()) ?? 0;
  }
  async getPricesEth(addresses: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const a of addresses) out.set(a.toLowerCase(), this.priceByAddr.get(a.toLowerCase()) ?? 0);
    return out;
  }
  async getSnapshotsEth(addresses: string[]): Promise<Map<string, PriceSnapshotEth>> {
    const out = new Map<string, PriceSnapshotEth>();
    for (const a of addresses) {
      const priceEth = this.priceByAddr.get(a.toLowerCase()) ?? 0;
      if (priceEth > 0) out.set(a.toLowerCase(), { priceEth, marketCapUsd: 0, symbol: "", logoUrl: null });
    }
    return out;
  }
  async getTokenSymbol(): Promise<string> {
    return "";
  }
}

/** Chain stub: quoteSell yields proceeds at a per-address realizable price, so
 *  the test can make one token a phantom (low realizable) and another a genuine
 *  winner (realizable ≈ snapshot). */
class StubChain implements ChainAdapter {
  constructor(private readonly realizableByAddr: Map<string, number>) {}
  getWalletAddress(): string {
    return "11111111111111111111111111111111";
  }
  async getWalletBalanceEth(): Promise<number> {
    return 1;
  }
  async buy(): Promise<SwapResult> {
    throw new Error("not used");
  }
  async sell(): Promise<SwapResult> {
    throw new Error("not used");
  }
  async getTokenPriceEth(): Promise<number> {
    return 0;
  }
  async quoteSell(address: string, amountTokens: number): Promise<{ proceedsEth: number }> {
    const price = this.realizableByAddr.get(address.toLowerCase()) ?? 0;
    return { proceedsEth: amountTokens * price };
  }
  async sendEth(): Promise<string> {
    return "0xsend";
  }
  async buybackAndBurn(): Promise<{ txHash: string; tokensBurned: number }> {
    return { txHash: "0xburn", tokensBurned: 0 };
  }
}

interface DashBody {
  openPositions: Array<{ id: string; unrealizedPct: number; currentPriceEth: number }>;
}

beforeEach(() => {
  _resetDashboardCacheForTest();
});

afterEach(() => {
  __setBaseDataForTest(null);
  __setChainForTest(null);
});

test("dashboard clamps a phantom Solana snapshot DOWN to the realizable price", async () => {
  const store = getStore();
  const PHANTOM = "so1phantom00000000000000000000000000000000pa";
  const WINNER = "so1winner000000000000000000000000000000000wi";

  await store.savePosition(openSolPosition("phantom", PHANTOM));
  await store.savePosition(openSolPosition("winner", WINNER));

  // Snapshot prints BOTH tokens 60× above entry (+5900%).
  const snapshotPrice = ENTRY * 60;
  __setBaseDataForTest(
    new StubBaseData(
      new Map([
        [PHANTOM.toLowerCase(), snapshotPrice],
        [WINNER.toLowerCase(), snapshotPrice],
      ]),
    ),
  );

  // But only the WINNER is actually realizable at that price; the PHANTOM can
  // only be sold back at entry (flat) — a manipulated pool that prints high but
  // can't be exited.
  __setChainForTest(
    new StubChain(
      new Map([
        [PHANTOM.toLowerCase(), ENTRY], // realizable = entry → flat
        [WINNER.toLowerCase(), snapshotPrice], // realizable ≈ snapshot → real gain
      ]),
    ),
  );

  const { res, result } = captureRes();
  await handle(getReq("/api/dashboard"), res);
  const { status, body } = result();
  assert.equal(status, 200);

  const { openPositions } = body as DashBody;
  const phantom = openPositions.find((p) => p.id === "phantom");
  const winner = openPositions.find((p) => p.id === "winner");
  assert.ok(phantom, "phantom position must be present");
  assert.ok(winner, "winner position must be present");

  // The phantom is clamped DOWN to realizable (flat): ~0% unrealised, NOT +5900%.
  assert.ok(
    Math.abs(phantom.unrealizedPct) < 1,
    `phantom unrealised must be clamped to ~0%, got ${phantom.unrealizedPct}%`,
  );
  assert.ok(
    Math.abs(phantom.currentPriceEth - ENTRY) < ENTRY * 0.01,
    `phantom currentPriceEth must be clamped to entry, got ${phantom.currentPriceEth}`,
  );

  // The genuine winner is UNAFFECTED — realizable ≈ snapshot, so it keeps its gain.
  assert.ok(
    winner.unrealizedPct > 5000,
    `genuine winner must keep its real gain (~+5900%), got ${winner.unrealizedPct}%`,
  );
});
