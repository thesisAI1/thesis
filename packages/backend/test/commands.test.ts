/**
 * RED tests for S10 — pure handleCommand function.
 * Module does not exist yet → RED.
 *
 * DI contract:
 *   handleCommand(
 *     text: string,
 *     chatId: string,
 *     deps?: { allowedChats?: string[]; store?: <narrow read interface> }
 *   ): Promise<string | null>
 *
 * Tests always pass deps explicitly (shared-process singleton safety).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { handleCommand } from "../src/adapters/telegram/commands.js";
import type { Position, Distribution, ReviewRecord } from "@thesis/shared";
import type { Funnel } from "../src/store/index.js";

// ---------------------------------------------------------------------------
// Minimal fake store — implements only the read methods handleCommand uses
// ---------------------------------------------------------------------------

const posOpen: Position = {
  id: "pos-001",
  postId: "tweet-111",
  authorXId: "user-42",
  authorHandle: "@alice",
  status: "open",
  entryPriceEth: 0.001,
  marketCapAtEntryUsd: 500_000,
  remainingFraction: 0.75,
  tiersHit: 1,
  realisedPnlEth: 0.05,
  openedAt: "2026-01-01T00:00:00Z",
  entryTxHash: "0xentryTxHash",
  order: {
    contractAddress: "0x1234567890abcdef1234567890abcdef12345678",
    chain: "base",
    amountInEth: 0.1,
    takeProfits: [{ priceX: 2, sellFraction: 0.5 }],
    stopLossX: 0.7,
  },
};

const posClosed: Position = {
  id: "pos-002",
  postId: "tweet-222",
  authorXId: "user-99",
  authorHandle: "@bob",
  status: "closed",
  entryPriceEth: 0.002,
  remainingFraction: 0,
  tiersHit: 2,
  realisedPnlEth: 0.12,
  openedAt: "2026-01-02T00:00:00Z",
  closedAt: "2026-01-10T00:00:00Z",
  entryTxHash: "0xclosedTxHash",
  order: {
    contractAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    chain: "base",
    amountInEth: 0.2,
    takeProfits: [{ priceX: 3, sellFraction: 1.0 }],
    stopLossX: 0.7,
  },
};

const dist1: Distribution = {
  positionId: "p1",
  totalProfitEth: 1,
  toAuthorEth: 0.4,
  toPortfolioEth: 0,
  toBuybackEth: 0,
  authorWallet: "0xWALLETwALLETwALLETwALLETwALLETwALLETwA",
};

const fakeReview: ReviewRecord = {
  reviewedAt: "2026-01-01T00:00:00Z",
  postId: "tweet-111",
  postUrl: "https://x.com/alice/status/111",
  authorXId: "user-42",
  authorHandle: "@alice",
  contractAddress: "0x1234567890abcdef1234567890abcdef12345678",
  chain: "base",
  authorScore: 80,
  tokenScore: 70,
  grade: "A",
  decision: "buy",
  confidence: 0.9,
  rationale: "Strong thesis",
};

const funnelData: Funnel = { seen: 10, passed: 3 };

const fakeStore = {
  getOpenPositions: async () => [posOpen],
  getAllPositions: async () => [posOpen, posClosed],
  getDistributions: async () => [dist1],
  getFunnel: async () => funnelData,
  getReviews: async () => [fakeReview],
} as unknown as Parameters<typeof handleCommand>[2] extends { store?: infer S } ? S : never;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleCommand — access control (AC4)", () => {
  it("non-allowlisted chatId → returns null", async () => {
    const result = await handleCommand("/positions", "999", {
      allowedChats: ["111"],
      store: fakeStore,
    });
    assert.equal(result, null, "non-allowlisted chat must get null (silently ignored)");
  });
});

describe("handleCommand — /positions", () => {
  it("returns a non-null string mentioning the open position id and handle", async () => {
    const result = await handleCommand("/positions", "111", {
      allowedChats: ["111"],
      store: fakeStore,
    });
    assert.ok(result !== null, "/positions should return a string for allowlisted chat");
    assert.ok(result!.includes("pos-001"), `should mention position id, got: ${result}`);
    assert.ok(result!.includes("@alice"), `should mention authorHandle, got: ${result}`);
  });

  it("does NOT include the full contract address (AC8 — address truncation)", async () => {
    const fullContract = "0x1234567890abcdef1234567890abcdef12345678";
    const result = await handleCommand("/positions", "111", {
      allowedChats: ["111"],
      store: fakeStore,
    });
    assert.ok(result !== null);
    assert.ok(
      !result!.includes(fullContract),
      `SECURITY: full contract address must not appear in /positions output. Got: ${result}`,
    );
  });
});

describe("handleCommand — /pnl", () => {
  it("returns realized PnL and total toAuthorEth", async () => {
    const result = await handleCommand("/pnl", "111", {
      allowedChats: ["111"],
      store: fakeStore,
    });
    assert.ok(result !== null, "/pnl should return a string");
    // posOpen.realisedPnlEth (0.05) + posClosed.realisedPnlEth (0.12) = 0.17
    assert.ok(
      result!.includes("0.17") || result!.includes("0.05") || result!.includes("0.12"),
      `should contain realized PnL numbers, got: ${result}`,
    );
    // dist1.toAuthorEth = 0.4
    assert.ok(result!.includes("0.4"), `should contain toAuthorEth total (0.4), got: ${result}`);
  });
});

describe("handleCommand — /stats", () => {
  it("returns funnel seen/passed counts", async () => {
    const result = await handleCommand("/stats", "111", {
      allowedChats: ["111"],
      store: fakeStore,
    });
    assert.ok(result !== null, "/stats should return a string");
    assert.ok(result!.includes("10"), `should contain funnel.seen (10), got: ${result}`);
    assert.ok(result!.includes("3"), `should contain funnel.passed (3), got: ${result}`);
  });
});

describe("handleCommand — /help", () => {
  it("returns non-null help text listing commands", async () => {
    const result = await handleCommand("/help", "111", {
      allowedChats: ["111"],
      store: fakeStore,
    });
    assert.ok(result !== null, "/help should return help text");
    // Should list at least some of the known commands
    assert.ok(
      result!.includes("/positions") || result!.includes("/pnl") || result!.includes("/stats"),
      `help text should list commands, got: ${result}`,
    );
  });
});
