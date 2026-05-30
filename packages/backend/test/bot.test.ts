/**
 * RED tests for S11 — handleUpdate (per-update routing, unit-testable seam from bot.ts).
 * Module does not exist yet → RED.
 *
 * DI contract:
 *   handleUpdate(
 *     update: { updateId: number; chatId: string; text: string },
 *     deps: { adapter: TelegramAdapter; allowedChats: string[]; store?: <narrow read interface> }
 *   ): Promise<void>
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { handleUpdate } from "../src/adapters/telegram/bot.js";
import { MockTelegram } from "../src/adapters/telegram/mock.js";
import { getEventLog } from "../src/observability/eventLog.js";
import type { Position, Distribution, ReviewRecord } from "@thesis/shared";
import type { Funnel } from "../src/store/index.js";

// ---------------------------------------------------------------------------
// Minimal fake store (same shape as commands.test.ts)
// ---------------------------------------------------------------------------

const posOpen: Position = {
  id: "pos-bot-001",
  postId: "tweet-bot-111",
  authorXId: "user-bot-42",
  authorHandle: "@charlie",
  status: "open",
  entryPriceEth: 0.001,
  remainingFraction: 1.0,
  tiersHit: 0,
  realisedPnlEth: 0,
  openedAt: "2026-01-01T00:00:00Z",
  entryTxHash: "0xbotEntryTxHash",
  order: {
    contractAddress: "0xabcdef1234567890abcdef1234567890abcdef12",
    chain: "base",
    amountInEth: 0.05,
    takeProfits: [{ priceX: 2, sellFraction: 1.0 }],
    stopLossX: 0.7,
  },
};

const fakeStore = {
  getOpenPositions: async (): Promise<Position[]> => [posOpen],
  getAllPositions: async (): Promise<Position[]> => [posOpen],
  getDistributions: async (): Promise<Distribution[]> => [],
  getFunnel: async (): Promise<Funnel> => ({ seen: 5, passed: 2 }),
  getReviews: async (): Promise<ReviewRecord[]> => [],
} as unknown as Parameters<typeof handleUpdate>[1] extends { store?: infer S } ? S : never;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleUpdate — non-allowlisted chat", () => {
  it("sends nothing when chatId is not in allowedChats", async () => {
    const mock = new MockTelegram();

    await handleUpdate(
      { updateId: 1, chatId: "999", text: "/status" },
      { adapter: mock, allowedChats: ["111"] },
    );

    assert.equal(mock.sent.length, 0, "non-allowlisted chat must receive no reply");
  });

  it("records a denied/ignored entry in the event log for non-allowlisted chat", async () => {
    const mock = new MockTelegram();

    await handleUpdate(
      { updateId: 1, chatId: "999", text: "/status" },
      { adapter: mock, allowedChats: ["111"] },
    );

    const recent = getEventLog().recent(5);
    const deniedEntry = recent.find(
      (e) =>
        e.area === "telegram" &&
        (e.msg.includes("999") || e.type.includes("denied") || e.type.includes("ignored")),
    );
    assert.ok(
      deniedEntry !== undefined,
      "a denied-chat entry must be recorded in the event log with area='telegram' and chatId '999'",
    );
  });
});

describe("handleUpdate — allowlisted chat", () => {
  it("replies to /help for an allowlisted chat", async () => {
    const mock = new MockTelegram();

    await handleUpdate(
      { updateId: 2, chatId: "111", text: "/help" },
      { adapter: mock, allowedChats: ["111"], store: fakeStore },
    );

    assert.equal(mock.sent.length, 1, "allowlisted chat should receive exactly one reply");
    assert.ok(
      mock.sent[0]!.text.length > 0,
      "reply text should be non-empty",
    );
  });
});
