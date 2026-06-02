/**
 * Wave 6 — startGroupNotifier integration tests.
 *
 * Uses MockTelegram as injected adapter, with a fake enrichment function
 * so no store/database access is needed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { startGroupNotifier, formatGroupEvent } from "../src/adapters/telegram/groupNotifier.js";
import { publishOps } from "../src/observability/opsBus.js";
import { MockTelegram } from "../src/adapters/telegram/mock.js";
import type { PositionEnrichment } from "../src/adapters/telegram/enrich.js";

// ---------------------------------------------------------------------------
// Fake enrichment — returns a known enrichment so no store/DB needed
// ---------------------------------------------------------------------------

const fakeEnrichment: PositionEnrichment & { found: true } = {
  found: true,
  symbol: "WIF",
  chain: "base",
  unit: "ETH",
  entryEth: 0.1,
  contract: "0xdeadbeefdeadbeefdeadbeef",
  authorHandle: "@alice",
};

function fakeEnrich(_positionId: string): Promise<PositionEnrichment> {
  return Promise.resolve(fakeEnrichment);
}

// Injected format function that uses fakeEnrich
function makeFormat() {
  return (e: Parameters<typeof formatGroupEvent>[0]) =>
    formatGroupEvent(e, { enrich: fakeEnrich });
}

// No-op resolveAsset (no asset dir in tests → fall back to sendMessage)
function nullResolve(_kind: string): null {
  return null;
}

// Poll until condition is met or timeout expires (default 500ms, polls every 5ms).
// Use this for tests that expect at least N sends — eliminates fixed-timeout flake.
async function waitUntil(
  condition: () => boolean,
  timeoutMs = 500,
  intervalMs = 5,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// For "sends nothing" tests there is no positive signal to poll.
// Drain the microtask/promise queue with one event-loop tick.
async function drainMicrotasks(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

const CHAT_ID = "-100123";
const BOT_TOKEN = "x";

// ---------------------------------------------------------------------------
// 1. Gating tests
// ---------------------------------------------------------------------------

describe("startGroupNotifier — gating", () => {
  it("disabled:false → no-op, sends nothing on trade:buy", async () => {
    const mock = new MockTelegram();
    const stop = startGroupNotifier({
      adapter: mock,
      enabled: false,
      chatId: CHAT_ID,
      botToken: BOT_TOKEN,
      format: makeFormat(),
      resolveAsset: nullResolve,
    });

    publishOps({ type: "trade:buy", at: new Date().toISOString(), positionId: "p1", handle: "@alice", amountEth: 0.1, contract: "0xdeadbeef", chain: "base" });
    await drainMicrotasks();
    stop();

    assert.equal(mock.sent.length, 0, "disabled → nothing sent");
    assert.equal(mock.sentAnimations.length, 0, "disabled → no animations");
  });

  it("empty chatId → no-op, sends nothing", async () => {
    const mock = new MockTelegram();
    const stop = startGroupNotifier({
      adapter: mock,
      enabled: true,
      chatId: "",
      botToken: BOT_TOKEN,
      format: makeFormat(),
      resolveAsset: nullResolve,
    });

    publishOps({ type: "trade:buy", at: new Date().toISOString(), positionId: "p1", handle: "@alice", amountEth: 0.1, contract: "0xdeadbeef", chain: "base" });
    await drainMicrotasks();
    stop();

    assert.equal(mock.sent.length, 0, "empty chatId → nothing sent");
  });

  it("empty botToken → no-op, sends nothing", async () => {
    const mock = new MockTelegram();
    const stop = startGroupNotifier({
      adapter: mock,
      enabled: true,
      chatId: CHAT_ID,
      botToken: "",
      format: makeFormat(),
      resolveAsset: nullResolve,
    });

    publishOps({ type: "trade:buy", at: new Date().toISOString(), positionId: "p1", handle: "@alice", amountEth: 0.1, contract: "0xdeadbeef", chain: "base" });
    await drainMicrotasks();
    stop();

    assert.equal(mock.sent.length, 0, "empty botToken → nothing sent");
  });
});

// ---------------------------------------------------------------------------
// 2. Filter test — only 5 events pass the formatter
// ---------------------------------------------------------------------------

describe("startGroupNotifier — event filter", () => {
  it("sends exactly 5 messages for the 5 announced kinds, none for others", async () => {
    const mock = new MockTelegram();
    const stop = startGroupNotifier({
      adapter: mock,
      enabled: true,
      chatId: CHAT_ID,
      botToken: BOT_TOKEN,
      format: makeFormat(),
      resolveAsset: nullResolve,
    });

    const at = new Date().toISOString();

    // Should send (5 total)
    publishOps({ type: "trade:buy",       at, positionId: "p1", handle: "@alice", amountEth: 0.1, contract: "0xabc", chain: "base" });
    publishOps({ type: "trade:sell",      at, positionId: "p2", tier: 1, proceedsEth: 0.2, profitEth: 0.1, chain: "base" });
    publishOps({ type: "settle:summary",  at, positionId: "p3", handle: "@alice", totalProfitEth: 0.5, toAuthorEth: 0.1, toPortfolioEth: 0.2, toBuybackEth: 0.1, authorPaid: "direct" });
    publishOps({ type: "position:close",  at, positionId: "p4", netPnlEth: -0.05, reason: "sl", chain: "base" });  // loss → sends
    publishOps({ type: "payout:sent",     at, path: "escrow", chain: "base", handle: "@alice", amountEth: 0.1, wallet: "0x1111", txHash: "0x2222" }); // escrow → sends

    // Should NOT send
    publishOps({ type: "payout:sent",     at, path: "direct", chain: "base", handle: "@alice", amountEth: 0.05, wallet: "0x3333", txHash: "0x4444" }); // direct → filtered
    publishOps({ type: "position:close",  at, positionId: "p5", netPnlEth: 0.2, reason: "tp", chain: "base" });  // win → filtered
    publishOps({ type: "error",           at, area: "svc", msg: "boom" });
    publishOps({ type: "liveness:stale",  at, secondsSinceTick: 120 });
    publishOps({ type: "tweet:posted",    at, kind: "buy", replyId: "r1", postId: "p1" });

    await waitUntil(() => mock.sent.length + mock.sentAnimations.length >= 5);
    stop();

    // No animations because resolveAsset always returns null
    const totalSent = mock.sent.length + mock.sentAnimations.length;
    assert.equal(totalSent, 5, `expected exactly 5 sends, got ${totalSent} (messages=${mock.sent.length}, animations=${mock.sentAnimations.length})`);
  });
});

// ---------------------------------------------------------------------------
// 3. Caption content test
// ---------------------------------------------------------------------------

describe("startGroupNotifier — caption content", () => {
  it("buy message caption contains the token symbol WIF", async () => {
    const mock = new MockTelegram();
    const stop = startGroupNotifier({
      adapter: mock,
      enabled: true,
      chatId: CHAT_ID,
      botToken: BOT_TOKEN,
      format: makeFormat(),
      resolveAsset: nullResolve,
    });

    publishOps({ type: "trade:buy", at: new Date().toISOString(), positionId: "p1", handle: "@alice", amountEth: 0.1, contract: "0xabc", chain: "base" });
    await waitUntil(() => mock.sent.length >= 1);
    stop();

    assert.equal(mock.sent.length, 1, "should have sent 1 message");
    assert.ok(mock.sent[0]!.text.includes("WIF"), `expected "WIF" in caption, got: ${mock.sent[0]!.text}`);
  });
});

// ---------------------------------------------------------------------------
// 4. Unsubscribe test
// ---------------------------------------------------------------------------

describe("startGroupNotifier — unsubscribe", () => {
  it("after stop(), further events send nothing", async () => {
    const mock = new MockTelegram();
    const stop = startGroupNotifier({
      adapter: mock,
      enabled: true,
      chatId: CHAT_ID,
      botToken: BOT_TOKEN,
      format: makeFormat(),
      resolveAsset: nullResolve,
    });

    publishOps({ type: "trade:buy", at: new Date().toISOString(), positionId: "p1", handle: "@alice", amountEth: 0.1, contract: "0xabc", chain: "base" });
    await waitUntil(() => mock.sent.length + mock.sentAnimations.length >= 1);

    const countBeforeStop = mock.sent.length + mock.sentAnimations.length;
    stop();

    publishOps({ type: "trade:buy", at: new Date().toISOString(), positionId: "p2", handle: "@bob", amountEth: 0.2, contract: "0xdef", chain: "base" });
    await drainMicrotasks();

    const countAfterStop = mock.sent.length + mock.sentAnimations.length;
    assert.equal(countAfterStop, countBeforeStop, "stop() must unsubscribe — no further sends after stop()");
  });
});
