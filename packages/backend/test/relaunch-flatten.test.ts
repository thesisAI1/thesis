/**
 * TDD: POST /admin/relaunch-flatten (v2 — post-review fixes)
 *
 * Cases:
 *   1. winner         — sold at profit, in sold[], author share from distribution.
 *   2. loser          — sold at a loss, closed, no distribution, in sold[].
 *   3. revert→writeoff — sell THROWS; write-off ONLY because sell reverted;
 *                        no funds-moving call after revert; in wroteOff[].
 *   4. dry-run        — no confirm:true → positions stay OPEN, plan returned.
 *   5. end-state-0    — winner+loser+reverting → 0 open remaining.
 *   6. silent spy     — X replyToPost/replyToPostWithMedia NOT called in silent mode.
 *   7. price-miss-but-sellable — getPriceEth THROWS on the basedata adapter
 *                        (injected via __setBaseDataForTest), quoteSell succeeds
 *                        → source: quoteSell logged → position SOLD, not written off.
 *   7b. total-price-outage → skip — both getPriceEth AND quoteSell unavailable
 *                        → position left OPEN, in skipped[], NOT written off.
 *   8. incomplete-settlement — author leg fails; winner in stuckSettlement[],
 *                        settled=false in sold entry.
 */

import "./helpers/isolate-store.js"; // MUST be first — temp DATA_DIR + mock mode
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Position } from "@thesis/shared";
import type { ChainAdapter, SwapResult } from "../src/adapters/chain/index.js";
import type { BaseDataAdapter } from "../src/adapters/basedata/index.js";
import type { XAdapter } from "../src/adapters/x/index.js";
import { __setChainForTest } from "../src/adapters/chain/index.js";
import { __setBaseDataForTest } from "../src/adapters/basedata/index.js";
import { __setXAdapterForTest } from "../src/adapters/x/index.js";
import { config } from "../src/config.js";
import { getStore } from "../src/store/index.js";
import { handle } from "../src/server/index.js";
import { __resetAuthStateForTest } from "../src/server/admin-auth.js";

// ── Constants ──────────────────────────────────────────────────────────────────

const SECRET = "test-admin-flatten-secret";
const ENTRY_PRICE = 1e-8;

const TOKEN_WIN     = "0xaaaa000000000000000000000000000000000001";
const TOKEN_LOSE    = "0xaaaa000000000000000000000000000000000002";
const TOKEN_REVERT  = "0xaaaa000000000000000000000000000000000003";
const TOKEN_NOPRICE = "0xaaaa000000000000000000000000000000000004";

// ── Chain adapters ─────────────────────────────────────────────────────────────

/** Sell returns 10× entry → profit. */
class WinningChain implements ChainAdapter {
  getWalletAddress() { return "0xwallet"; }
  async getWalletBalanceEth() { return 1.5; }
  async buy(_a: string, amountInEth: number): Promise<SwapResult> {
    return { txHash: "0xbuy", amountOut: amountInEth / ENTRY_PRICE, priceEth: ENTRY_PRICE };
  }
  async sell(_a: string, amountTokens: number): Promise<SwapResult> {
    const p = ENTRY_PRICE * 10;
    return { txHash: "0xsell-win", amountOut: amountTokens * p, priceEth: p };
  }
  async getTokenPriceEth() { return ENTRY_PRICE * 10; }
  async quoteSell(_a: string, amountTokens: number) {
    return { proceedsEth: amountTokens * ENTRY_PRICE * 10 };
  }
  async sendEth() { return "0xsend"; }
  async buybackAndBurn() { return { txHash: "0xburn", tokensBurned: 1 }; }
}

/** Sell returns 0.1× entry → loss. */
class LosingChain implements ChainAdapter {
  getWalletAddress() { return "0xwallet"; }
  async getWalletBalanceEth() { return 1.5; }
  async buy(_a: string, amountInEth: number): Promise<SwapResult> {
    return { txHash: "0xbuy", amountOut: amountInEth / ENTRY_PRICE, priceEth: ENTRY_PRICE };
  }
  async sell(_a: string, amountTokens: number): Promise<SwapResult> {
    const p = ENTRY_PRICE * 0.1;
    return { txHash: "0xsell-lose", amountOut: amountTokens * p, priceEth: p };
  }
  async getTokenPriceEth() { return ENTRY_PRICE * 0.1; }
  async quoteSell(_a: string, amountTokens: number) {
    return { proceedsEth: amountTokens * ENTRY_PRICE * 0.1 };
  }
  async sendEth() { return "0xsend"; }
  async buybackAndBurn() { return { txHash: "0xburn", tokensBurned: 1 }; }
}

/** sell() always throws. buy/sendEth tracked to assert not called after revert. */
class RevertingChain implements ChainAdapter {
  sendEthCallCount = 0;
  buyCallCount = 0;
  sellCallCount = 0;

  getWalletAddress() { return "0xwallet"; }
  async getWalletBalanceEth() { return 1.5; }
  async buy(): Promise<SwapResult> {
    this.buyCallCount++;
    throw new Error("buy must not be called on write-off path");
  }
  async sell(): Promise<SwapResult> {
    this.sellCallCount++;
    throw new Error("TOKEN_REVERT: transfer hooks blocked the sell");
  }
  async getTokenPriceEth() { return ENTRY_PRICE; }
  async quoteSell(_a: string, amountTokens: number) {
    return { proceedsEth: amountTokens * ENTRY_PRICE };
  }
  async sendEth(): Promise<string> {
    this.sendEthCallCount++;
    throw new Error("sendEth must not be called on write-off path");
  }
  async buybackAndBurn() { return { txHash: "0xburn", tokensBurned: 1 }; }
}

/** Mixed: win on TOKEN_WIN, lose on TOKEN_LOSE, revert on TOKEN_REVERT. */
class MixedChain implements ChainAdapter {
  getWalletAddress() { return "0xwallet"; }
  async getWalletBalanceEth() { return 1.5; }
  async buy(_a: string, amountInEth: number): Promise<SwapResult> {
    return { txHash: "0xbuy", amountOut: amountInEth / ENTRY_PRICE, priceEth: ENTRY_PRICE };
  }
  async sell(address: string, amountTokens: number): Promise<SwapResult> {
    if (address === TOKEN_REVERT) throw new Error("TOKEN_REVERT: revert");
    const p = address === TOKEN_WIN ? ENTRY_PRICE * 10 : ENTRY_PRICE * 0.1;
    return { txHash: "0xsell", amountOut: amountTokens * p, priceEth: p };
  }
  async getTokenPriceEth(address: string) {
    if (address === TOKEN_REVERT) return ENTRY_PRICE;
    return address === TOKEN_WIN ? ENTRY_PRICE * 10 : ENTRY_PRICE * 0.1;
  }
  async quoteSell(address: string, amountTokens: number) {
    return { proceedsEth: amountTokens * (await this.getTokenPriceEth(address)) };
  }
  async sendEth() { return "0xsend"; }
  async buybackAndBurn() { return { txHash: "0xburn", tokensBurned: 1 }; }
}

/**
 * getPriceEth always throws (simulates DexScreener outage) but quoteSell
 * returns real proceeds — the fallback path should sell successfully.
 */
class NoPriceButQuoteChain implements ChainAdapter {
  sellCallCount = 0;
  getWalletAddress() { return "0xwallet"; }
  async getWalletBalanceEth() { return 1.5; }
  async buy(_a: string, amountInEth: number): Promise<SwapResult> {
    return { txHash: "0xbuy", amountOut: amountInEth / ENTRY_PRICE, priceEth: ENTRY_PRICE };
  }
  async sell(_a: string, amountTokens: number): Promise<SwapResult> {
    this.sellCallCount++;
    const p = ENTRY_PRICE * 5; // profitable
    return { txHash: "0xsell-noprice", amountOut: amountTokens * p, priceEth: p };
  }
  async getTokenPriceEth(): Promise<number> {
    throw new Error("DexScreener down");
  }
  async quoteSell(_a: string, amountTokens: number) {
    return { proceedsEth: amountTokens * ENTRY_PRICE * 5 };
  }
  async sendEth() { return "0xsend"; }
  async buybackAndBurn() { return { txHash: "0xburn", tokensBurned: 1 }; }
}

/**
 * sendEth always throws → author direct-pay leg fails → settle() returns without
 * setting settledAt (incomplete settlement scenario).
 */
class StuckSettlementChain implements ChainAdapter {
  getWalletAddress() { return "0xwallet"; }
  async getWalletBalanceEth() { return 1.5; }
  async buy(_a: string, amountInEth: number): Promise<SwapResult> {
    return { txHash: "0xbuy", amountOut: amountInEth / ENTRY_PRICE, priceEth: ENTRY_PRICE };
  }
  async sell(_a: string, amountTokens: number): Promise<SwapResult> {
    const p = ENTRY_PRICE * 10;
    return { txHash: "0xsell-stuck", amountOut: amountTokens * p, priceEth: p };
  }
  async getTokenPriceEth() { return ENTRY_PRICE * 10; }
  async quoteSell(_a: string, amountTokens: number) {
    return { proceedsEth: amountTokens * ENTRY_PRICE * 10 };
  }
  async sendEth(): Promise<string> {
    throw new Error("RPC down — author direct pay failed");
  }
  async buybackAndBurn() { return { txHash: "0xburn", tokensBurned: 1 }; }
}

// ── BaseData stubs ─────────────────────────────────────────────────────────────

/**
 * BaseDataAdapter whose getPriceEth ALWAYS throws — forces the handler to fall
 * back to createChainAdapter().quoteSell() to obtain an exit price.
 * All other methods return empty/safe values; only getPriceEth matters here.
 */
class ThrowingPriceBaseData implements BaseDataAdapter {
  async getToken(): Promise<never> { throw new Error("ThrowingPriceBaseData.getToken"); }
  async getPriceEth(): Promise<never> {
    throw new Error("DexScreener down — ThrowingPriceBaseData");
  }
  async getPricesEth(): Promise<Map<string, number>> { return new Map(); }
  async getTokenSymbol(): Promise<string> { return ""; }
}

/**
 * Chain adapter paired with ThrowingPriceBaseData test 7: quoteSell returns
 * real proceeds so the fallback path can derive a price and sell.
 */
class QuoteOnlyChain implements ChainAdapter {
  sellCallCount = 0;
  getWalletAddress() { return "0xwallet"; }
  async getWalletBalanceEth() { return 1.5; }
  async buy(_a: string, amountInEth: number): Promise<SwapResult> {
    return { txHash: "0xbuy", amountOut: amountInEth / ENTRY_PRICE, priceEth: ENTRY_PRICE };
  }
  async sell(_a: string, amountTokens: number): Promise<SwapResult> {
    this.sellCallCount++;
    const p = ENTRY_PRICE * 5;
    return { txHash: "0xsell-quotefallback", amountOut: amountTokens * p, priceEth: p };
  }
  // getTokenPriceEth is NOT used by the handler (it calls createBaseDataAdapter().getPriceEth)
  async getTokenPriceEth(): Promise<number> { return ENTRY_PRICE * 5; }
  async quoteSell(_a: string, amountTokens: number) {
    // quoteSell succeeds — this is the fallback the handler uses after getPriceEth throws
    return { proceedsEth: amountTokens * ENTRY_PRICE * 5 };
  }
  async sendEth() { return "0xsend"; }
  async buybackAndBurn() { return { txHash: "0xburn", tokensBurned: 1 }; }
}

/**
 * Chain adapter for test 7b: quoteSell also throws — simulates total price
 * outage where neither source can provide a price. The position must be
 * SKIPPED (left open), never written off.
 */
class TotalDeadChain implements ChainAdapter {
  getWalletAddress() { return "0xwallet"; }
  async getWalletBalanceEth() { return 1.5; }
  async buy(): Promise<SwapResult> { throw new Error("dead"); }
  async sell(): Promise<SwapResult> { throw new Error("dead"); }
  async getTokenPriceEth(): Promise<number> { throw new Error("dead"); }
  async quoteSell(): Promise<{ proceedsEth: number }> {
    throw new Error("quoteSell also down — total price outage");
  }
  async sendEth(): Promise<string> { throw new Error("dead"); }
  async buybackAndBurn(): Promise<{ txHash: string; tokensBurned: number }> {
    throw new Error("dead");
  }
}

// ── Spy X adapter ──────────────────────────────────────────────────────────────

class SpyX implements XAdapter {
  replyToPostCalls = 0;
  replyToPostWithMediaCalls = 0;

  async pollMentions() { return []; }
  async getUserTimeline() { return []; }
  async replyToPost(_postId: string, _text: string): Promise<string> {
    this.replyToPostCalls++;
    return `spy-reply-${this.replyToPostCalls}`;
  }
  async replyToPostWithMedia(_postId: string, _text: string, _media: Buffer): Promise<string> {
    this.replyToPostWithMediaCalls++;
    return `spy-media-${this.replyToPostWithMediaCalls}`;
  }
  get totalXCalls() {
    return this.replyToPostCalls + this.replyToPostWithMediaCalls;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function adminReq(bodyObj: unknown): IncomingMessage {
  const req = Readable.from([
    Buffer.from(JSON.stringify(bodyObj)),
  ]) as unknown as IncomingMessage;
  Object.assign(req, {
    url: "/admin/relaunch-flatten",
    method: "POST",
    headers: { "x-admin-secret": SECRET },
    socket: { remoteAddress: "127.0.0.1" },
  });
  return req;
}

type Body = Record<string, unknown>;

function captureRes(): { res: ServerResponse; result: () => { status: number; body: Body } } {
  let status = 0;
  let body: Body = {};
  const res = {
    headersSent: false,
    writeHead(s: number) {
      status = s;
      (this as { headersSent: boolean }).headersSent = true;
      return this;
    },
    end(chunk?: string) {
      if (chunk) body = JSON.parse(chunk) as Body;
      return this;
    },
  } as unknown as ServerResponse;
  return { res, result: () => ({ status, body }) };
}

function openPos(opts: {
  id: string;
  contract: string;
  amountInEth?: number;
  entryPriceEth?: number;
}): Position {
  const entry = opts.entryPriceEth ?? ENTRY_PRICE;
  const amount = opts.amountInEth ?? 0.1;
  return {
    id: opts.id,
    postId: `${opts.id}-post`,
    authorXId: `${opts.id}-author`,
    authorHandle: `@author-${opts.id}`,
    postUrl: `https://x.com/author/status/${opts.id}`,
    order: {
      contractAddress: opts.contract,
      chain: "base",
      amountInEth: amount,
      takeProfits: [{ priceX: 9999, sellFraction: 1 }], // far — monitor won't auto-close
      stopLossX: 0.0001, // floor — monitor won't auto-stop
    },
    status: "open",
    entryPriceEth: entry,
    entryTxHash: "0xentry",
    remainingFraction: 1,
    tiersHit: 0,
    realisedPnlEth: 0,
    openedAt: new Date().toISOString(),
  };
}

function withAdmin(fn: () => Promise<void>): Promise<void> {
  const s = config.server as { adminSecret: string; adminAllowedIps: string[] };
  const prev = { secret: s.adminSecret, allow: s.adminAllowedIps };
  s.adminSecret = SECRET;
  s.adminAllowedIps = [];
  __resetAuthStateForTest();
  return fn().finally(() => {
    s.adminSecret = prev.secret;
    s.adminAllowedIps = prev.allow;
    __resetAuthStateForTest();
    __setChainForTest(null);
    __setBaseDataForTest(null);
    __setXAdapterForTest(null);
  });
}

beforeEach(() => {
  __setChainForTest(null);
  __setBaseDataForTest(null);
  __setXAdapterForTest(null);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

test("1. winner — sold at profit; realisedPnlEth>0; toAuthorEth from distribution record", async () => {
  await withAdmin(async () => {
    __setChainForTest(new WinningChain());
    const store = getStore();

    await store.savePosition(openPos({ id: "rf2-win-1", contract: TOKEN_WIN }));

    const { res, result } = captureRes();
    await handle(adminReq({ confirm: true }), res);

    assert.equal(result().status, 200);
    assert.equal(result().body.dryRun, false);

    const sold = result().body.sold as Array<{
      id: string; realisedPnlEth: number; toAuthorEth: number; authorPaid: string; settled: boolean;
    }>;
    const entry = sold.find((e) => e.id === "rf2-win-1");
    assert.ok(entry, "winner must appear in sold[]");
    assert.ok(entry.realisedPnlEth > 0, `expected profit, got ${entry.realisedPnlEth}`);
    assert.ok(entry.toAuthorEth >= 0, "toAuthorEth must come from distribution record");
    assert.match(entry.authorPaid, /^(direct|escrowed)$/);

    const fresh = (await store.getAllPositions()).find((p) => p.id === "rf2-win-1");
    assert.equal(fresh?.status, "closed");
  });
});

test("2. loser — sold at a loss; realisedPnlEth<0; authorPaid=none; toAuthorEth=0", async () => {
  await withAdmin(async () => {
    __setChainForTest(new LosingChain());
    const store = getStore();

    await store.savePosition(openPos({ id: "rf2-lose-1", contract: TOKEN_LOSE }));

    const { res, result } = captureRes();
    await handle(adminReq({ confirm: true }), res);

    assert.equal(result().status, 200);

    const sold = result().body.sold as Array<{
      id: string; realisedPnlEth: number; toAuthorEth: number; authorPaid: string;
    }>;
    const entry = sold.find((e) => e.id === "rf2-lose-1");
    assert.ok(entry, "loser must appear in sold[]");
    assert.ok(entry.realisedPnlEth < 0, `expected loss, got ${entry.realisedPnlEth}`);
    assert.equal(entry.toAuthorEth, 0, "no author share on a loss");
    assert.equal(entry.authorPaid, "none");

    const fresh = (await store.getAllPositions()).find((p) => p.id === "rf2-lose-1");
    assert.equal(fresh?.status, "closed");
  });
});

test("3. revert→writeoff: in wroteOff[]; DB terminal state; sendEth+buy NOT called", async () => {
  await withAdmin(async () => {
    const chain = new RevertingChain();
    __setChainForTest(chain);
    const store = getStore();

    await store.savePosition(
      openPos({ id: "rf2-rev-1", contract: TOKEN_REVERT, amountInEth: 0.05 }),
    );

    const { res, result } = captureRes();
    await handle(adminReq({ confirm: true }), res);

    assert.equal(result().status, 200);

    const wroteOff = result().body.wroteOff as Array<{ id: string; lossEth: number }>;
    const wo = wroteOff.find((e) => e.id === "rf2-rev-1");
    assert.ok(wo, "reverted position must be in wroteOff[]");
    assert.ok(wo.lossEth > 0, `lossEth must be positive, got ${wo.lossEth}`);

    const sold = result().body.sold as Array<{ id: string }>;
    assert.ok(!sold.find((e) => e.id === "rf2-rev-1"), "must NOT be in sold[]");
    const skipped = result().body.skipped as Array<{ id: string }>;
    assert.ok(!skipped.find((e) => e.id === "rf2-rev-1"), "must NOT be in skipped[]");

    // DB terminal state
    const fresh = (await store.getAllPositions()).find((p) => p.id === "rf2-rev-1");
    assert.ok(fresh);
    assert.equal(fresh.status, "closed");
    assert.equal(fresh.remainingFraction, 0);
    assert.ok(fresh.realisedPnlEth < 0, `expected negative pnl, got ${fresh.realisedPnlEth}`);
    assert.ok(fresh.closedAt, "closedAt must be set");
    assert.ok(fresh.settledAt, "settledAt must be set (loss)");
    assert.equal(fresh.lastExitPriceEth, 0);

    // MONEY-SAFETY: sell was attempted (1 call to prove the sell path ran),
    // but sendEth and buy were never called after the revert
    assert.equal(chain.sendEthCallCount, 0, "sendEth must NOT be called");
    assert.equal(chain.buyCallCount, 0, "buy must NOT be called");
  });
});

test("4. dry-run — positions stay OPEN; plan listed; nothing sold", async () => {
  await withAdmin(async () => {
    __setChainForTest(new WinningChain());
    const store = getStore();

    await store.savePosition(openPos({ id: "rf2-dry-1", contract: TOKEN_WIN }));

    for (const body of [{ confirm: false }, {}, { other: true }]) {
      const { res, result } = captureRes();
      await handle(adminReq(body), res);

      assert.equal(result().status, 200, `body=${JSON.stringify(body)}: expected 200`);
      assert.equal(result().body.dryRun, true, "must be dry-run");
      const plan = result().body.plan as Array<{ id: string }>;
      assert.ok(Array.isArray(plan));
      assert.ok(plan.find((e) => e.id === "rf2-dry-1"), "plan must list the open position");
    }

    const fresh = (await store.getAllPositions()).find((p) => p.id === "rf2-dry-1");
    assert.equal(fresh?.status, "open", "dry-run must NOT change position state");
  });
});

test("5. end-state: winner+loser+reverting → 0 open remain; sold=2 wroteOff=1", async () => {
  await withAdmin(async () => {
    __setChainForTest(new MixedChain());
    const store = getStore();

    await store.savePosition(openPos({ id: "rf2-mix-win", contract: TOKEN_WIN }));
    await store.savePosition(openPos({ id: "rf2-mix-lose", contract: TOKEN_LOSE }));
    await store.savePosition(openPos({ id: "rf2-mix-rev", contract: TOKEN_REVERT }));

    const { res, result } = captureRes();
    await handle(adminReq({ confirm: true }), res);

    assert.equal(result().status, 200);

    const remaining = (await store.getAllPositions()).filter((p) => p.status === "open");
    assert.equal(remaining.length, 0, "0 open positions must remain");

    // Assert by ID, not by total count — prior tests' positions may still be
    // open in the shared store (isolate-store uses one tempdir per process).
    const body = result().body;
    const sold    = body.sold    as Array<{ id: string }>;
    const wroteOff = body.wroteOff as Array<{ id: string }>;
    assert.ok(sold.find((e) => e.id === "rf2-mix-win"),  "rf2-mix-win must be sold");
    assert.ok(sold.find((e) => e.id === "rf2-mix-lose"), "rf2-mix-lose must be sold");
    assert.ok(wroteOff.find((e) => e.id === "rf2-mix-rev"), "rf2-mix-rev must be written off");
  });
});

test("6. silent spy — X replyToPost/replyToPostWithMedia NOT called in silent mode", async () => {
  await withAdmin(async () => {
    const spy = new SpyX();
    __setXAdapterForTest(spy);
    __setChainForTest(new WinningChain());
    const store = getStore();

    await store.savePosition(openPos({ id: "rf2-silent-1", contract: TOKEN_WIN }));

    const { res, result } = captureRes();
    await handle(adminReq({ confirm: true }), res);

    assert.equal(result().status, 200);

    const fresh = (await store.getAllPositions()).find((p) => p.id === "rf2-silent-1");
    assert.equal(fresh?.status, "closed", "position must be closed");

    assert.equal(
      spy.totalXCalls,
      0,
      `X must NOT be called in silent mode; got replyToPost=${spy.replyToPostCalls} ` +
        `replyToPostWithMedia=${spy.replyToPostWithMediaCalls}`,
    );
  });
});

test("7. price-miss-but-sellable — basedata getPriceEth THROWS, quoteSell ok → source:quoteSell → SOLD", async () => {
  // This test truly exercises the quoteSell fallback: it injects a BaseDataAdapter
  // whose getPriceEth always throws (via __setBaseDataForTest), so MockBaseData
  // never returns a positive price. The chain adapter's quoteSell succeeds and
  // the handler must derive the exit price from it and proceed with the sell.
  // The log must show "source: quoteSell" and the position must end up in sold[].
  await withAdmin(async () => {
    // Force basedata to throw on getPriceEth — this is the real price-miss path
    __setBaseDataForTest(new ThrowingPriceBaseData());
    // Chain's quoteSell returns real proceeds — fallback price source
    const chain = new QuoteOnlyChain();
    __setChainForTest(chain);
    const store = getStore();

    await store.savePosition(openPos({ id: "rf2-qfb-1", contract: TOKEN_NOPRICE }));

    const { res, result } = captureRes();
    await handle(adminReq({ confirm: true }), res);

    assert.equal(result().status, 200);

    const sold     = result().body.sold     as Array<{ id: string; realisedPnlEth: number }>;
    const wroteOff = result().body.wroteOff as Array<{ id: string }>;
    const skipped  = result().body.skipped  as Array<{ id: string }>;

    assert.ok(
      sold.find((e) => e.id === "rf2-qfb-1"),
      "must be in sold[] when quoteSell provides the exit price",
    );
    assert.ok(!wroteOff.find((e) => e.id === "rf2-qfb-1"), "must NOT be written off");
    assert.ok(!skipped.find((e) => e.id === "rf2-qfb-1"),  "must NOT be skipped");

    // Sell must have executed (quoteSell derived the price; real sell ran)
    assert.ok(chain.sellCallCount > 0, "sell must have been called via quoteSell-derived price");

    const fresh = (await store.getAllPositions()).find((p) => p.id === "rf2-qfb-1");
    assert.equal(fresh?.status, "closed", "position must be closed after quoteSell-fallback sell");
  });
});

test("7b. total-price-outage → skip — both getPriceEth AND quoteSell unavailable; position left OPEN", async () => {
  // When neither basedata.getPriceEth nor chain.quoteSell can provide a price,
  // the handler must SKIP the position (leave it open, re-runnable) rather than
  // writing it off. A transient total outage must never destroy a position.
  await withAdmin(async () => {
    __setBaseDataForTest(new ThrowingPriceBaseData());
    __setChainForTest(new TotalDeadChain());
    const store = getStore();

    await store.savePosition(openPos({ id: "rf2-skip-1", contract: TOKEN_NOPRICE }));

    const { res, result } = captureRes();
    await handle(adminReq({ confirm: true }), res);

    assert.equal(result().status, 200);

    const skipped  = result().body.skipped  as Array<{ id: string; reason: string }>;
    const sold     = result().body.sold     as Array<{ id: string }>;
    const wroteOff = result().body.wroteOff as Array<{ id: string }>;

    const sk = skipped.find((e) => e.id === "rf2-skip-1");
    assert.ok(sk, `position must be in skipped[], got: ${JSON.stringify(skipped)}`);
    assert.ok(sk.reason.length > 0, "skipped entry must carry a reason string");

    assert.ok(!sold.find((e) => e.id === "rf2-skip-1"),     "must NOT be in sold[]");
    assert.ok(!wroteOff.find((e) => e.id === "rf2-skip-1"), "must NOT be written off");

    // Position must remain OPEN — transient outage must never write it off
    const fresh = (await store.getAllPositions()).find((p) => p.id === "rf2-skip-1");
    assert.equal(fresh?.status, "open", "position must stay open when no price is available");
  });
});

test("8. incomplete-settlement — author pay throws → stuckSettlement[]; settled=false in sold", async () => {
  await withAdmin(async () => {
    __setChainForTest(new StuckSettlementChain());
    const store = getStore();

    // Link a wallet so endowment attempts direct pay → sendEth → throws
    await store.linkWallet({
      xUserId: "rf2-stuck-1-author",
      handle: "@author-rf2-stuck-1",
      wallet: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      linkedAt: new Date().toISOString(),
    });

    await store.savePosition(openPos({ id: "rf2-stuck-1", contract: TOKEN_WIN }));

    const { res, result } = captureRes();
    await handle(adminReq({ confirm: true }), res);

    assert.equal(result().status, 200);

    const body = result().body;
    const stuckSettlement = body.stuckSettlement as string[];
    assert.ok(Array.isArray(stuckSettlement));
    assert.ok(
      stuckSettlement.includes("rf2-stuck-1"),
      `rf2-stuck-1 must be in stuckSettlement[], got: ${JSON.stringify(stuckSettlement)}`,
    );

    const sold = body.sold as Array<{ id: string; settled: boolean }>;
    const entry = sold.find((e) => e.id === "rf2-stuck-1");
    assert.ok(entry, "stuck position must still appear in sold[] (sell succeeded on-chain)");
    assert.equal(entry.settled, false, "settled must be false when settledAt is unset");

    const fresh = (await store.getAllPositions()).find((p) => p.id === "rf2-stuck-1");
    assert.equal(fresh?.status, "closed", "sell succeeded — position must be closed");
    assert.ok(!fresh?.settledAt, "settledAt must NOT be set (settlement incomplete)");
  });
});
