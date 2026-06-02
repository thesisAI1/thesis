/**
 * Wave 5 — group formatter (groupNotifier.ts) tests.
 *
 * Uses a fake enrich() so no store/network needed.
 * Assertions are substring-based — not brittle exact-match.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatGroupEvent } from "../src/adapters/telegram/groupNotifier.js";
import type { OpsEvent } from "../src/observability/opsBus.js";
import type { PositionEnrichment } from "../src/adapters/telegram/enrich.js";

// ── Fake enrichment ───────────────────────────────────────────────────────────

const FAKE_ENR: PositionEnrichment = {
  found: true,
  symbol: "WIF",
  chain: "base",
  unit: "ETH",
  entryEth: 0.1,
  contract: "0xabcdef1234567890abcdef1234567890abcdef12",
  authorHandle: "@alice",
};

function fakeEnrich(_id: string): Promise<PositionEnrichment> {
  return Promise.resolve(FAKE_ENR);
}

const deps = { enrich: fakeEnrich };

// ── trade:buy ─────────────────────────────────────────────────────────────────

describe("formatGroupEvent trade:buy", () => {
  test("returns non-null, text contains WIF and @alice, gif === buy", async () => {
    const e: OpsEvent = {
      type: "trade:buy",
      at: new Date().toISOString(),
      positionId: "p1",
      handle: "@alice",
      amountEth: 0.1,
      contract: "0xabcdef1234567890abcdef1234567890abcdef12",
      chain: "base",
    };
    const msg = await formatGroupEvent(e, deps);
    assert.ok(msg !== null, "expected non-null");
    assert.ok(msg.text.includes("WIF"), `text should contain WIF: ${msg.text}`);
    assert.ok(msg.text.includes("@alice"), `text should contain @alice: ${msg.text}`);
    assert.equal(msg.gif, "buy");
  });

  test("security: no raw contract address in buy message", async () => {
    const e: OpsEvent = {
      type: "trade:buy",
      at: new Date().toISOString(),
      positionId: "p1",
      handle: "@alice",
      amountEth: 0.1,
      contract: "0xabcdef1234567890abcdef1234567890abcdef12",
      chain: "base",
    };
    const msg = await formatGroupEvent(e, deps);
    assert.ok(msg !== null);
    assert.ok(
      !msg.text.includes(FAKE_ENR.contract),
      `text must not contain raw contract: ${msg.text}`,
    );
    assert.ok(
      !/0x[0-9a-fA-F]{20,}/.test(msg.text),
      `text must not contain unredacted hex address: ${msg.text}`,
    );
  });
});

// ── trade:sell ────────────────────────────────────────────────────────────────

describe("formatGroupEvent trade:sell", () => {
  test("realized % comes from event fields, not config tier value", async () => {
    // cost basis = proceedsEth - profitEth = 0.5 - 0.4 = 0.1 → gain = 0.4/0.1 = +400%
    // The configured tier-1 value is "+100%" — if the caption shows +400% it's event-driven.
    const e: OpsEvent = {
      type: "trade:sell",
      at: new Date().toISOString(),
      positionId: "p1",
      tier: 1,
      proceedsEth: 0.5,
      profitEth: 0.4,
      chain: "base",
    };
    const msg = await formatGroupEvent(e, deps);
    assert.ok(msg !== null, "expected non-null");
    assert.ok(msg.text.includes("WIF"), `text should contain WIF: ${msg.text}`);
    assert.ok(msg.text.includes("0.4"), `text should contain profit amount: ${msg.text}`);
    assert.ok(msg.text.includes("@alice"), `text should contain author handle: ${msg.text}`);
    assert.ok(msg.text.includes("+400%"), `text should contain realized +400%: ${msg.text}`);
    assert.ok(msg.text.includes("TP1"), `text should contain TP1 tier label: ${msg.text}`);
    assert.ok(!msg.text.includes("+100%"), `text must NOT contain hardcoded config tier +100%: ${msg.text}`);
    assert.equal(msg.gif, "tp");
  });
});

// ── settle:summary ────────────────────────────────────────────────────────────

describe("formatGroupEvent settle:summary", () => {
  test("direct pay: contains WIF, pnlPct, @alice, all four split legs, gif === close-split", async () => {
    const e: OpsEvent = {
      type: "settle:summary",
      at: new Date().toISOString(),
      positionId: "p1",
      handle: "@alice",
      totalProfitEth: 0.8,
      toAuthorEth: 0.2,
      toPortfolioEth: 0.3,
      toTeamEth: 0.15,
      toBuybackEth: 0.15,
      authorPaid: "direct",
    };
    // pnlPct(0.8, 0.1) = 800
    const msg = await formatGroupEvent(e, deps);
    assert.ok(msg !== null, "expected non-null");
    assert.ok(msg.text.includes("WIF"), `text should contain WIF: ${msg.text}`);
    assert.ok(msg.text.includes("800"), `text should contain 800 (percent): ${msg.text}`);
    assert.ok(msg.text.includes("@alice"), `text should contain @alice: ${msg.text}`);
    // All four split legs present
    assert.ok(msg.text.includes("0.2"), `text should contain toAuthorEth: ${msg.text}`);
    assert.ok(msg.text.includes("0.3"), `text should contain toPortfolioEth: ${msg.text}`);
    assert.ok(msg.text.includes("0.15"), `text should contain toTeamEth: ${msg.text}`);
    assert.ok(msg.text.toLowerCase().includes("buyback"), `text should mention buyback: ${msg.text}`);
    assert.equal(msg.gif, "close-split");
  });

  test("escrowed: text mentions reserved/awaiting", async () => {
    const e: OpsEvent = {
      type: "settle:summary",
      at: new Date().toISOString(),
      positionId: "p1",
      handle: "@alice",
      totalProfitEth: 0.8,
      toAuthorEth: 0.2,
      toPortfolioEth: 0.3,
      toTeamEth: 0.15,
      toBuybackEth: 0.15,
      authorPaid: "escrowed",
    };
    const msg = await formatGroupEvent(e, deps);
    assert.ok(msg !== null);
    const lower = msg.text.toLowerCase();
    assert.ok(
      lower.includes("reserved") || lower.includes("awaiting"),
      `text should mention reserved/awaiting: ${msg.text}`,
    );
  });

  test("security: no raw contract address in settle:summary", async () => {
    const e: OpsEvent = {
      type: "settle:summary",
      at: new Date().toISOString(),
      positionId: "p1",
      handle: "@alice",
      totalProfitEth: 0.8,
      toAuthorEth: 0.2,
      toPortfolioEth: 0.3,
      toTeamEth: 0.15,
      toBuybackEth: 0.15,
      authorPaid: "direct",
    };
    const msg = await formatGroupEvent(e, deps);
    assert.ok(msg !== null);
    assert.ok(
      !msg.text.includes(FAKE_ENR.contract),
      `text must not contain raw contract: ${msg.text}`,
    );
    assert.ok(
      !/0x[0-9a-fA-F]{20,}/.test(msg.text),
      `text must not contain unredacted hex address: ${msg.text}`,
    );
  });
});

// ── position:close ────────────────────────────────────────────────────────────

describe("formatGroupEvent position:close", () => {
  test("netPnl > 0 → null (win covered by settle:summary)", async () => {
    const e: OpsEvent = {
      type: "position:close",
      at: new Date().toISOString(),
      positionId: "p1",
      netPnlEth: 0.5,
      reason: "tp",
      chain: "base",
    };
    const msg = await formatGroupEvent(e, deps);
    assert.equal(msg, null);
  });

  test("netPnl < 0 → non-null, contains negative pct, gif null", async () => {
    const e: OpsEvent = {
      type: "position:close",
      at: new Date().toISOString(),
      positionId: "p1",
      netPnlEth: -0.05,
      reason: "sl",
      chain: "base",
    };
    // pnlPct(-0.05, 0.1) = -50
    const msg = await formatGroupEvent(e, deps);
    assert.ok(msg !== null, "expected non-null for a loss");
    assert.ok(msg.text.includes("-50"), `text should contain negative pct: ${msg.text}`);
    assert.equal(msg.gif, null);
  });

  test("netPnl === 0 → non-null (boundary: not a win)", async () => {
    const e: OpsEvent = {
      type: "position:close",
      at: new Date().toISOString(),
      positionId: "p1",
      netPnlEth: 0,
      reason: "manual",
      chain: "base",
    };
    const msg = await formatGroupEvent(e, deps);
    assert.ok(msg !== null, "expected non-null for netPnl===0");
  });
});

// ── payout:sent ───────────────────────────────────────────────────────────────

describe("formatGroupEvent payout:sent", () => {
  test("path escrow, chain:base → non-null, contains @alice and ETH, gif author-claim", async () => {
    const e: OpsEvent = {
      type: "payout:sent",
      at: new Date().toISOString(),
      path: "escrow",
      chain: "base",
      handle: "@alice",
      amountEth: 0.2,
      wallet: "0xA1Ace00000000000000000000000000000001A1A",
      txHash: "0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678",
    };
    const msg = await formatGroupEvent(e, deps);
    assert.ok(msg !== null, "expected non-null for escrow path");
    assert.ok(msg.text.includes("@alice"), `text should contain @alice: ${msg.text}`);
    assert.ok(msg.text.includes("ETH"), `chain:base caption must contain ETH: ${msg.text}`);
    assert.equal(msg.gif, "author-claim");
  });

  test("path escrow, chain:solana → non-null, contains SOL (proves unit is chain-driven)", async () => {
    const e: OpsEvent = {
      type: "payout:sent",
      at: new Date().toISOString(),
      path: "escrow",
      chain: "solana",
      handle: "@alice",
      amountEth: 0.2,
      wallet: "SolWallet111111111111111111111111111",
      txHash: "solTx1111111111111111111111111111111111111111111111111111111111111111",
    };
    const msg = await formatGroupEvent(e, deps);
    assert.ok(msg !== null, "expected non-null for solana escrow path");
    assert.ok(msg.text.includes("SOL"), `chain:solana caption must contain SOL: ${msg.text}`);
    assert.ok(!msg.text.includes("ETH"), `chain:solana caption must NOT contain ETH: ${msg.text}`);
    assert.equal(msg.gif, "author-claim");
  });

  test("path direct → null", async () => {
    const e: OpsEvent = {
      type: "payout:sent",
      at: new Date().toISOString(),
      path: "direct",
      chain: "base",
      handle: "@alice",
      amountEth: 0.2,
      wallet: "0xA1Ace00000000000000000000000000000001A1A",
      txHash: "0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678",
    };
    const msg = await formatGroupEvent(e, deps);
    assert.equal(msg, null);
  });
});

// ── Security: no-leak assertions for trade:sell, position:close(loss), payout:sent(escrow) ──

describe("formatGroupEvent security no-leak", () => {
  test("trade:sell: no contract address or 0x hex in TP message", async () => {
    const e: OpsEvent = {
      type: "trade:sell",
      at: new Date().toISOString(),
      positionId: "p1",
      tier: 1,
      proceedsEth: 0.15,
      profitEth: 0.05,
      chain: "base",
    };
    const msg = await formatGroupEvent(e, deps);
    assert.ok(msg !== null);
    assert.ok(
      !msg.text.includes(FAKE_ENR.contract),
      `text must not contain raw contract: ${msg.text}`,
    );
    assert.ok(
      !/0x[0-9a-fA-F]{20,}/.test(msg.text),
      `text must not contain unredacted hex address: ${msg.text}`,
    );
  });

  test("position:close (loss): no contract address or 0x hex in loss message", async () => {
    const e: OpsEvent = {
      type: "position:close",
      at: new Date().toISOString(),
      positionId: "p1",
      netPnlEth: -0.05,
      reason: "sl",
      chain: "base",
    };
    const msg = await formatGroupEvent(e, deps);
    assert.ok(msg !== null);
    assert.ok(
      !msg.text.includes(FAKE_ENR.contract),
      `text must not contain raw contract: ${msg.text}`,
    );
    assert.ok(
      !/0x[0-9a-fA-F]{20,}/.test(msg.text),
      `text must not contain unredacted hex address: ${msg.text}`,
    );
  });

  test("payout:sent (escrow): no wallet, txHash, or 0x hex in claim message", async () => {
    const wallet = "0xBEEF000000000000000000000000000000BEEF01";
    const txHash = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab";
    const e: OpsEvent = {
      type: "payout:sent",
      at: new Date().toISOString(),
      path: "escrow",
      chain: "base",
      handle: "@alice",
      amountEth: 0.2,
      wallet,
      txHash,
    };
    const msg = await formatGroupEvent(e, deps);
    assert.ok(msg !== null);
    assert.ok(
      !msg.text.includes(wallet),
      `text must not contain raw wallet address: ${msg.text}`,
    );
    assert.ok(
      !msg.text.includes(txHash),
      `text must not contain raw txHash: ${msg.text}`,
    );
    assert.ok(
      !/0x[0-9a-fA-F]{20,}/.test(msg.text),
      `text must not contain unredacted hex address: ${msg.text}`,
    );
  });
});

// ── Noise events → null ───────────────────────────────────────────────────────

describe("formatGroupEvent noise events", () => {
  test("error → null", async () => {
    const e: OpsEvent = { type: "error", at: "", area: "svc", msg: "boom" };
    assert.equal(await formatGroupEvent(e, deps), null);
  });

  test("liveness:stale → null", async () => {
    const e: OpsEvent = { type: "liveness:stale", at: "", secondsSinceTick: 60 };
    assert.equal(await formatGroupEvent(e, deps), null);
  });

  test("tweet:posted → null", async () => {
    const e: OpsEvent = { type: "tweet:posted", at: "", kind: "buy", replyId: "1", postId: "2" };
    assert.equal(await formatGroupEvent(e, deps), null);
  });

  test("settle:done → null", async () => {
    const e: OpsEvent = { type: "settle:done", at: "", chain: "base", positionId: "p", toAuthorEth: 0, totalProfitEth: 0 };
    assert.equal(await formatGroupEvent(e, deps), null);
  });

  test("payout:failed → null (carries chain-error strings with wallets/hashes)", async () => {
    const e: OpsEvent = {
      type: "payout:failed",
      at: "",
      chain: "base",
      handle: "@alice",
      amountEth: 0.1,
      reason: "execution reverted: 0xdeadbeef wallet=0xA1Ace00000000000000000000000000000001A1A",
    };
    assert.equal(await formatGroupEvent(e, deps), null);
  });

  test("settle:failed → null (carries chain-error strings with positionId/tx hashes)", async () => {
    const e: OpsEvent = {
      type: "settle:failed",
      at: "",
      positionId: "p1",
      reason: "tx 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab reverted",
    };
    assert.equal(await formatGroupEvent(e, deps), null);
  });
});
