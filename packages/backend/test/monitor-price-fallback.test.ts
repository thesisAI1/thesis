/**
 * TDD: on-chain price fallback + unpriceable-streak escalation in the monitor.
 *
 * RED phase: these tests fail before the fallback pre-pass and streak counter
 *            are added to monitor/index.ts.
 *
 * GREEN phase: they pass once the implementation is in place.
 *
 * Four scenarios:
 *   1. DexScreener silent (no price) → quoteSell fallback rescues the position
 *      → SL fires (fallback price is first-class).
 *   2. Both sources fail for 3 consecutive ticks → `price-blind:streak` error
 *      event emitted on tick 3; position NOT processed.
 *   3. Fallback/primary recovers after previous failures → streak resets to 0
 *      → a single later failure is `warn` (price-blind:tick), not `error`.
 *   4. streak≥3 dedup: the error ops event is emitted only ONCE; additional
 *      ticks at streak≥3 do NOT re-publish to the ops bus.
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
import { getEventLog, resetEventLogForTest } from "../src/observability/eventLog.js";
import { subscribeOps } from "../src/observability/opsBus.js";
import type { OpsEvent } from "../src/observability/opsBus.js";

// Clear the injected test adapters after every case so a seam set by one test
// can't leak into another (defends against shared-process test isolation).
afterEach(() => {
  __setBaseDataForTest(null);
  __setChainForTest(null);
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A stub BaseDataAdapter that returns no price for any address. */
function noopBaseData(): BaseDataAdapter {
  return {
    async getToken(_a: string): Promise<TokenOnChain> {
      return {
        contractAddress: _a,
        chain: "base",
        priceEth: 0,
        liquidityUsd: 0,
        marketCapUsd: 0,
        launchedAt: new Date().toISOString(),
        launchpad: null,
        isHoneypot: false,
        topHolders: [],
      };
    },
    async getPriceEth(_a: string): Promise<number> { return 0; },
    async getPricesEth(addrs: string[]): Promise<Map<string, number>> {
      return new Map(addrs.map((a) => [a.toLowerCase(), 0]));
    },
    async getTokenSymbol(_a: string): Promise<string> { return ""; },
  };
}

/** A stub BaseDataAdapter that returns no price (absent from map, not 0). */
function missingPriceBaseData(): BaseDataAdapter {
  return {
    async getToken(_a: string): Promise<TokenOnChain> {
      return {
        contractAddress: _a,
        chain: "base",
        priceEth: 0,
        liquidityUsd: 0,
        marketCapUsd: 0,
        launchedAt: new Date().toISOString(),
        launchpad: null,
        isHoneypot: false,
        topHolders: [],
      };
    },
    async getPriceEth(_a: string): Promise<number> { return 0; },
    async getPricesEth(_addrs: string[]): Promise<Map<string, number>> {
      // Returns an empty map — token completely absent (DexScreener silent)
      return new Map();
    },
    async getTokenSymbol(_a: string): Promise<string> { return ""; },
  };
}

/** A stub ChainAdapter that returns a specific price from getTokenPriceEth
 *  and records sell calls. */
function priceChainAdapter(price: number): ChainAdapter & { sells: number } {
  const adapter = {
    sells: 0,
    getWalletAddress(): string { return "0xWALLET"; },
    async getWalletBalanceEth(): Promise<number> { return 1.0; },
    async buy(_a: string, amountInEth: number): Promise<SwapResult> {
      return { txHash: "0xBUY", amountOut: amountInEth / price, priceEth: price };
    },
    async sell(_a: string, amountTokens: number): Promise<SwapResult> {
      adapter.sells += 1;
      return { txHash: "0xSELL", amountOut: amountTokens * price, priceEth: price };
    },
    async getTokenPriceEth(_a: string): Promise<number> { return price; },
    async quoteSell(_a: string, amountTokens: number): Promise<{ proceedsEth: number }> {
      return { proceedsEth: amountTokens * price };
    },
    async sendEth(_to: string, _amt: number): Promise<string> { return "0xSEND"; },
    async buybackAndBurn(_amt: number): Promise<{ txHash: string; tokensBurned: number }> {
      return { txHash: "0xBURN", tokensBurned: 0 };
    },
  };
  return adapter;
}

/** A stub ChainAdapter where both getTokenPriceEth and quoteSell fail.
 *  Used to simulate a true dual-source outage so the position stays unpriced. */
function failingPriceChainAdapter(): ChainAdapter {
  return {
    getWalletAddress(): string { return "0xWALLET"; },
    async getWalletBalanceEth(): Promise<number> { return 1.0; },
    async buy(_a: string, amountInEth: number): Promise<SwapResult> {
      return { txHash: "0xBUY", amountOut: amountInEth / 1e-8, priceEth: 1e-8 };
    },
    async sell(_a: string, amountTokens: number): Promise<SwapResult> {
      return { txHash: "0xSELL", amountOut: amountTokens * 1e-8, priceEth: 1e-8 };
    },
    async getTokenPriceEth(_a: string): Promise<number> {
      throw new Error("chain price unavailable");
    },
    // Fallback now uses quoteSell; returning 0 simulates a true dual-source outage.
    async quoteSell(_a: string, _amountTokens: number): Promise<{ proceedsEth: number }> {
      return { proceedsEth: 0 };
    },
    async sendEth(_to: string, _amt: number): Promise<string> { return "0xSEND"; },
    async buybackAndBurn(_amt: number): Promise<{ txHash: string; tokensBurned: number }> {
      return { txHash: "0xBURN", tokensBurned: 0 };
    },
  };
}

/** Build a minimal open position whose stop-loss will fire at `slPrice`. */
function openPositionAt(opts: {
  id: string;
  contractAddress: string;
  entryPriceEth: number;
  /** stopLossX so that stopPrice = entryPriceEth * stopLossX fires at slPrice */
  stopLossX: number;
}): Position {
  return {
    id: opts.id,
    postId: `${opts.id}-post`,
    authorXId: `${opts.id}-author`,
    authorHandle: "@author",
    postUrl: `https://x.com/author/status/${opts.id}`,
    order: {
      contractAddress: opts.contractAddress,
      chain: "base",
      amountInEth: 0.1,
      takeProfits: [{ priceX: 10, sellFraction: 1 }], // TP very high — won't fire
      stopLossX: opts.stopLossX,
    },
    status: "open",
    entryPriceEth: opts.entryPriceEth,
    entryTxHash: "0xENTRY",
    remainingFraction: 1,
    tiersHit: 0,
    realisedPnlEth: 0,
    openedAt: new Date().toISOString(),
  };
}

// ── Test 1: fallback rescues stop-loss ────────────────────────────────────────

test("fallback: on-chain price rescues a position DexScreener missed → SL fires", async () => {
  resetEventLogForTest();

  const addr = "0xfallback0000000000000000000000000000000001";
  // entry = 1e-6, stopLossX = 2 → stopPrice = 2e-6
  // fallback price = 1.5e-6 < 2e-6 → SL fires
  const pos = openPositionAt({
    id: "pos-fallback-sl",
    contractAddress: addr,
    entryPriceEth: 1e-6,
    stopLossX: 2,         // stopPrice = entry * 1 * stopLossX = 2e-6 (no tiers hit yet)
  });

  const chain = priceChainAdapter(1.5e-6);

  __setBaseDataForTest(missingPriceBaseData()); // DexScreener returns nothing
  __setChainForTest(chain);

  const store = getStore();
  await store.savePosition(pos);

  await runMonitorTick();

  // SL was fired → sell was called
  assert.equal(chain.sells, 1, "sell should have been called once (SL triggered via fallback price)");

  // Position should be closed
  const all = await store.getAllPositions();
  const closed = all.find((p) => p.id === pos.id);
  assert.equal(closed?.status, "closed", "position should be closed after SL via fallback");

  // A price-fallback:used event should have been emitted
  const events = getEventLog().recent(20);
  const fallbackEvent = events.find((e) => e.type === "price-fallback:used");
  assert.ok(fallbackEvent, "price-fallback:used event must be emitted");
});

// ── Test 2: both-fail 3 consecutive ticks → error event ─────────────────────

test("streak: both sources fail 3 ticks → price-blind:streak error event emitted", async () => {
  resetEventLogForTest();

  const addr = "0xblind000000000000000000000000000000000002";
  const pos = openPositionAt({
    id: "pos-blind-streak",
    contractAddress: addr,
    entryPriceEth: 1e-6,
    stopLossX: 0.7,
  });

  __setBaseDataForTest(missingPriceBaseData()); // DexScreener returns nothing
  __setChainForTest(failingPriceChainAdapter()); // chain also fails

  const store = getStore();
  await store.savePosition(pos);

  // Tick 1: warn only
  await runMonitorTick();
  let events = getEventLog().recent(20);
  assert.ok(
    !events.some((e) => e.type === "price-blind:streak" && e.level === "error"),
    "tick 1: no error event yet",
  );

  // Tick 2: warn only
  await runMonitorTick();
  events = getEventLog().recent(20);
  assert.ok(
    !events.some((e) => e.type === "price-blind:streak" && e.level === "error"),
    "tick 2: no error event yet",
  );

  // Tick 3: error escalates
  await runMonitorTick();
  events = getEventLog().recent(20);
  const streakEvent = events.find((e) => e.type === "price-blind:streak" && e.level === "error");
  assert.ok(streakEvent, "tick 3: price-blind:streak error event must be emitted");

  // Position must NOT be processed (still open)
  const all = await store.getAllPositions();
  const still = all.find((p) => p.id === pos.id);
  assert.equal(still?.status, "open", "position must remain open when unpriced");
});

// ── Test 4: streak≥3 dedup — error ops event emitted only ONCE ───────────────

/** Collect ops events published during `fn()`. */
async function captureOps(fn: () => Promise<void>): Promise<OpsEvent[]> {
  const events: OpsEvent[] = [];
  const unsub = subscribeOps((e) => events.push(e));
  try {
    await fn();
  } finally {
    unsub();
  }
  return events;
}

test("dedup: price-blind:streak error ops event fires once, not on every tick≥3", async () => {
  resetEventLogForTest();

  const addr = "0xdedup000000000000000000000000000000000004";
  const pos = openPositionAt({
    id: "pos-dedup-streak",
    contractAddress: addr,
    entryPriceEth: 1e-6,
    stopLossX: 0.7,
  });

  __setBaseDataForTest(missingPriceBaseData()); // DexScreener returns nothing
  __setChainForTest(failingPriceChainAdapter()); // quoteSell also fails

  const store = getStore();
  await store.savePosition(pos);

  // Ticks 1+2: warn only — no error ops events
  await runMonitorTick();
  await runMonitorTick();

  // Tick 3: streak≥3 → exactly 1 error ops event
  const ops3 = await captureOps(() => runMonitorTick());
  const errorOps3 = ops3.filter(
    (e): e is Extract<OpsEvent, { type: "error" }> =>
      e.type === "error" && e.area === "monitor" && e.msg.includes(pos.id),
  );
  assert.equal(errorOps3.length, 1, "tick 3: exactly 1 error ops event for the streak");

  // Tick 4: still failing — NO additional ops error event (dedup guard fires)
  const ops4 = await captureOps(() => runMonitorTick());
  const errorOps4 = ops4.filter(
    (e): e is Extract<OpsEvent, { type: "error" }> =>
      e.type === "error" && e.area === "monitor" && e.msg.includes(pos.id),
  );
  assert.equal(errorOps4.length, 0, "tick 4: no additional error ops event (dedup guard)");

  // Tick 5: still failing — still NO additional ops error event
  const ops5 = await captureOps(() => runMonitorTick());
  const errorOps5 = ops5.filter(
    (e): e is Extract<OpsEvent, { type: "error" }> =>
      e.type === "error" && e.area === "monitor" && e.msg.includes(pos.id),
  );
  assert.equal(errorOps5.length, 0, "tick 5: no additional error ops event (dedup guard)");
});

// ── Test 3: recovery resets streak ───────────────────────────────────────────

test("streak: recovery resets streak — subsequent single failure is warn, not error", async () => {
  resetEventLogForTest();

  const addr = "0xrecover00000000000000000000000000000000003";
  // entry high enough that a price of 5e-7 doesn't trip the SL (stopLossX=0.7 → stopPrice=7e-7)
  // but we need the position to NOT be processed/closed so it stays open for all ticks.
  // Use a price that is above the SL (entry=1e-6, stop=7e-7, fallback gives 9e-8 which IS below stop)
  // Actually we want recovery without SL firing, so we use a high price that's above entry but below TP.
  // TP is 10× entry = 1e-5. Use recovery price of 1.1e-6 (above entry, no SL, no TP).
  const pos = openPositionAt({
    id: "pos-recover-streak",
    contractAddress: addr,
    entryPriceEth: 1e-6,
    stopLossX: 0.7, // stopPrice = 1e-6 * 1 * 0.7 = 7e-7
  });

  const store = getStore();
  await store.savePosition(pos);

  // ── Ticks 1+2: both sources fail → streak=2 for THIS position ──────────────
  __setBaseDataForTest(missingPriceBaseData());
  __setChainForTest(failingPriceChainAdapter());

  await runMonitorTick();
  await runMonitorTick();

  // Confirm no error event mentioning THIS specific position yet
  {
    const events = getEventLog().recent(50);
    assert.ok(
      !events.some(
        (e) =>
          e.type === "price-blind:streak" &&
          e.level === "error" &&
          e.msg.includes(pos.id),
      ),
      "after 2 failures: no error event for pos-recover-streak yet",
    );
  }

  // ── Tick 3 with recovery (DexScreener returns a price this time) ──────────
  // Price must be above SL (7e-7) and below TP (1e-5) so position stays open.
  const recoveringBaseData: BaseDataAdapter = {
    async getToken(_a: string): Promise<TokenOnChain> {
      return {
        contractAddress: _a, chain: "base", priceEth: 1.1e-6,
        liquidityUsd: 0, marketCapUsd: 0,
        launchedAt: new Date().toISOString(), launchpad: null,
        isHoneypot: false, topHolders: [],
      };
    },
    async getPriceEth(_a: string): Promise<number> { return 1.1e-6; },
    async getPricesEth(addrs: string[]): Promise<Map<string, number>> {
      return new Map(addrs.map((a) => [a.toLowerCase(), 1.1e-6]));
    },
    async getTokenSymbol(_a: string): Promise<string> { return ""; },
  };
  __setBaseDataForTest(recoveringBaseData);

  await runMonitorTick();

  // Position should still be open (price above SL, below TP)
  {
    const all = await store.getAllPositions();
    const stillOpen = all.find((p) => p.id === pos.id);
    assert.equal(stillOpen?.status, "open", "position should still be open after recovery tick");
  }

  // ── Tick 4: single failure again → warn (not error, streak reset) ──────────
  resetEventLogForTest(); // clear all previous events so we get a clean slate
  __setBaseDataForTest(missingPriceBaseData());
  __setChainForTest(failingPriceChainAdapter());

  await runMonitorTick();

  {
    const events = getEventLog().recent(50);
    // Should see a warn-level price-blind:tick for THIS position
    // Should NOT see an error price-blind:streak for THIS position
    const warnEvent = events.find(
      (e) => e.type === "price-blind:tick" && e.level === "warn" && e.msg.includes(pos.id),
    );
    const errorEvent = events.find(
      (e) =>
        e.type === "price-blind:streak" &&
        e.level === "error" &&
        e.msg.includes(pos.id),
    );
    assert.ok(warnEvent, "single failure after reset: warn event expected for pos-recover-streak");
    assert.ok(!errorEvent, "single failure after reset: no error event (streak was reset)");
  }
});
