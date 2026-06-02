/**
 * Wave 4 — Enrichment helper tests.
 * All fakes injected — no network, no store singleton.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

import type { Chain, Position } from "@thesis/shared";
import {
  pnlPct,
  resolveSymbol,
  clearSymbolCache,
  enrichPosition,
  type PositionEnrichment,
} from "../src/adapters/telegram/enrich.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePosition(opts: {
  id: string;
  chain: Chain;
  contractAddress?: string;
  amountInEth?: number;
  authorHandle?: string;
}): Position {
  return {
    id: opts.id,
    postId: `${opts.id}-post`,
    authorXId: "123456",
    authorHandle: opts.authorHandle ?? "@testauthor",
    order: {
      contractAddress: opts.contractAddress ?? "0xabcabcabcabcabcabcabcabcabcabcabcabcabca",
      chain: opts.chain,
      amountInEth: opts.amountInEth ?? 0.1,
      takeProfits: [{ priceX: 2, sellFraction: 1 }],
      stopLossX: 0.7,
    },
    status: "closed",
    entryPriceEth: 1e-8,
    entryTxHash: "0xentry",
    remainingFraction: 0,
    tiersHit: 1,
    realisedPnlEth: 0.21,
    openedAt: new Date().toISOString(),
  };
}

function fakeStore(positions: Position[]) {
  return {
    getAllPositions: async () => positions,
    // Satisfy the Store interface minimally — only getAllPositions is used here
    getOpenPositions: async () => [],
    getUnsettledClosedPositions: async () => [],
    savePosition: async () => {},
    linkWallet: async () => {},
    getRegistryEntry: async () => null,
    recordPendingBuy: async () => {},
    getPendingBuys: async () => [],
    clearPendingBuy: async () => {},
    recordBuy: async () => {},
    countBuysSince: async () => 0,
    lastBuyAt: async () => null,
    addEscrow: async () => {},
    getEscrow: async () => null,
    clearEscrow: async () => {},
    clearPayout: async () => {},
    addPayoutRequest: async () => {},
    getPayoutRequests: async () => [],
    clearPayoutRequestsForUser: async () => {},
    enqueue: async () => {},
    getQueue: async () => [],
    dequeueHighest: async () => null,
    pruneQueue: async () => 0,
    bumpFunnel: async () => {},
    getFunnel: async () => ({ seen: 0, passed: 0 }),
    isProcessed: async () => false,
    markProcessed: async () => {},
    saveReview: async () => {},
    getReviews: async () => [],
    saveDistribution: async () => {},
    getDistributions: async () => [],
  };
}

// ── pnlPct ────────────────────────────────────────────────────────────────────

describe("pnlPct", () => {
  it("210% gain: 0.21/0.1", () => {
    assert.equal(pnlPct(0.21, 0.1), 210);
  });

  it("-50% loss: -0.05/0.1", () => {
    assert.equal(pnlPct(-0.05, 0.1), -50);
  });

  it("zero entry guard: anything/0 → 0", () => {
    assert.equal(pnlPct(1.0, 0), 0);
    assert.equal(pnlPct(-1.0, 0), 0);
  });

  it("rounding: 0.0156/0.1 → 16", () => {
    assert.equal(pnlPct(0.0156, 0.1), 16);
  });
});

// ── resolveSymbol ─────────────────────────────────────────────────────────────

describe("resolveSymbol", () => {
  beforeEach(() => {
    clearSymbolCache();
  });

  it("calls underlying once, then hits cache", async () => {
    let callCount = 0;
    const getSymbol = async (_c: string, _ch: Chain) => {
      callCount++;
      return "DEGEN";
    };

    const addr = "0xdeadbeef";
    const r1 = await resolveSymbol(addr, "base", { getSymbol });
    const r2 = await resolveSymbol(addr, "base", { getSymbol });

    assert.equal(r1, "DEGEN");
    assert.equal(r2, "DEGEN");
    assert.equal(callCount, 1, "underlying called only once (cache hit)");
  });

  it("cache is keyed by lowercased address", async () => {
    let callCount = 0;
    const getSymbol = async () => {
      callCount++;
      return "TOKEN";
    };

    await resolveSymbol("0xABCDEF", "base", { getSymbol });
    await resolveSymbol("0xabcdef", "base", { getSymbol });

    assert.equal(callCount, 1);
  });

  it("throwing getSymbol → returns '' and does not poison cache (next call retries)", async () => {
    let callCount = 0;
    const addr = "0xfail";

    const getSymbolFail = async () => {
      callCount++;
      throw new Error("network error");
    };
    const result1 = await resolveSymbol(addr, "base", { getSymbol: getSymbolFail });
    assert.equal(result1, "");
    assert.equal(callCount, 1);

    // Second call retries (not poisoned)
    const result2 = await resolveSymbol(addr, "base", { getSymbol: getSymbolFail });
    assert.equal(result2, "");
    assert.equal(callCount, 2, "retried after failure (not cached)");
  });

  it("empty string result → returns '' and does not cache", async () => {
    let callCount = 0;
    const getSymbol = async () => {
      callCount++;
      return "";
    };

    const r1 = await resolveSymbol("0xempty", "base", { getSymbol });
    const r2 = await resolveSymbol("0xempty", "base", { getSymbol });

    assert.equal(r1, "");
    assert.equal(r2, "");
    assert.equal(callCount, 2, "retried because empty was not cached");
  });
});

// ── enrichPosition ────────────────────────────────────────────────────────────

describe("enrichPosition", () => {
  beforeEach(() => {
    clearSymbolCache();
  });

  it("found=true with correct fields for base chain", async () => {
    const pos = makePosition({ id: "pos-1", chain: "base", amountInEth: 0.05, authorHandle: "@alice" });
    const store = fakeStore([pos]);
    const getSymbol = async () => "DEGEN";

    const result = await enrichPosition("pos-1", { store, getSymbol }) as Extract<PositionEnrichment, { found: true }>;

    assert.equal(result.found, true);
    assert.equal(result.symbol, "DEGEN");
    assert.equal(result.chain, "base");
    assert.equal(result.unit, "ETH");
    assert.equal(result.entryEth, 0.05);
    assert.equal(result.contract, pos.order.contractAddress);
    assert.equal(result.authorHandle, "@alice");
  });

  it("found=true with unit=SOL for solana chain", async () => {
    const pos = makePosition({ id: "pos-sol", chain: "solana", amountInEth: 0.2 });
    const store = fakeStore([pos]);
    const getSymbol = async () => "BONK";

    const result = await enrichPosition("pos-sol", { store, getSymbol }) as Extract<PositionEnrichment, { found: true }>;

    assert.equal(result.found, true);
    assert.equal(result.unit, "SOL");
    assert.equal(result.symbol, "BONK");
  });

  it("unknown id → { found: false }", async () => {
    const store = fakeStore([]);
    const result = await enrichPosition("no-such-id", { store });
    assert.equal(result.found, false);
  });

  it("symbol resolver throwing → symbol='', still found=true", async () => {
    const pos = makePosition({ id: "pos-err", chain: "base" });
    const store = fakeStore([pos]);
    const getSymbol = async () => { throw new Error("RPC down"); };

    const result = await enrichPosition("pos-err", { store, getSymbol }) as Extract<PositionEnrichment, { found: true }>;

    assert.equal(result.found, true);
    assert.equal(result.symbol, "");
  });
});
