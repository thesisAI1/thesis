/**
 * RED → GREEN — admin bot polish:
 *   - /status@thesislogbot resolves to /status (menu-tap @mention strip)
 *   - money values use the per-chain ticker (ETH/SOL), never the Ξ glyph
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { handleCommand } from "../src/adapters/telegram/commands.js";
import type { Position, Distribution, ReviewRecord } from "@thesis/shared";
import type { Funnel } from "../src/store/index.js";

const posOpen: Position = {
  id: "pos-001", postId: "t1", authorXId: "u1", authorHandle: "@alice",
  status: "open", entryPriceEth: 0.001, remainingFraction: 0.75, tiersHit: 1,
  realisedPnlEth: 0.05, openedAt: "2026-01-01T00:00:00Z", entryTxHash: "0xtx",
  order: { contractAddress: "0x1234567890abcdef1234567890abcdef12345678", chain: "base", amountInEth: 0.1, takeProfits: [{ priceX: 2, sellFraction: 0.5 }], stopLossX: 0.7 },
};
const dist1: Distribution = {
  positionId: "pos-001", totalProfitEth: 1, toAuthorEth: 0.4,
  toPortfolioEth: 0, toTeamEth: 0, toBuybackEth: 0, authorWallet: null,
};
const review: ReviewRecord = {
  reviewedAt: "2026-01-01T00:00:00Z", postId: "t1", postUrl: "https://x.com/a/status/1",
  authorXId: "u1", authorHandle: "@alice", contractAddress: posOpen.order.contractAddress,
  chain: "base", authorScore: 80, tokenScore: 70, grade: "A", decision: "BUY",
  confidence: 0.9, rationale: "ok",
};
const funnel: Funnel = { seen: 10, passed: 3 };
const store = {
  getOpenPositions: async () => [posOpen],
  getAllPositions: async () => [posOpen],
  getDistributions: async () => [dist1],
  getFunnel: async () => funnel,
  getReviews: async () => [review],
} as unknown as Parameters<typeof handleCommand>[2] extends { store?: infer S } ? S : never;

const ALLOW = ["111"];

describe("admin polish — @mention strip", () => {
  it("/status@thesislogbot resolves like /status", async () => {
    const r = await handleCommand("/status@thesislogbot", "111", { allowedChats: ALLOW, store });
    assert.ok(r !== null, "menu-tapped command must resolve, not fall to unknown");
    assert.ok(/open positions/i.test(r!), `expected status text, got: ${r}`);
  });
});

describe("admin polish — ticker not glyph", () => {
  it("/positions uses ETH ticker, never Ξ", async () => {
    const r = await handleCommand("/positions", "111", { allowedChats: ALLOW, store });
    assert.ok(r !== null);
    assert.ok(!r!.includes("Ξ"), `must not use the Ξ glyph, got: ${r}`);
    assert.ok(r!.includes("ETH"), `expected ETH ticker, got: ${r}`);
  });
  it("/pnl uses ETH ticker, never Ξ, and still reports the author total", async () => {
    const r = await handleCommand("/pnl", "111", { allowedChats: ALLOW, store });
    assert.ok(r !== null);
    assert.ok(!r!.includes("Ξ"), `must not use the Ξ glyph, got: ${r}`);
    assert.ok(r!.includes("ETH"), `expected ETH ticker, got: ${r}`);
    assert.ok(r!.includes("0.4"), `expected author total 0.4, got: ${r}`);
  });
});
