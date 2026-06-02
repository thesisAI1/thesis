/**
 * RED → GREEN — public group command handler (handleGroupCommand).
 *
 * Pure function: (text, deps) -> Promise<string | null>. null == silent
 * (unknown command / no reply). DI store + getSymbol so it runs offline.
 *
 * SAFETY (load-bearing): public output is names-only — never a wallet, never a
 * tx-hash. The ONLY contract that may appear is inside an /open chart link.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { handleGroupCommand } from "../src/adapters/telegram/groupCommands.js";
import { clearSymbolCache, resolveSymbol } from "../src/adapters/telegram/enrich.js";
import type { Chain, Position, Distribution, ReviewRecord } from "@thesis/shared";
import type { Funnel } from "../src/store/index.js";

const C = {
  win: "0xW1111111111111111111111111111111111111aa",
  win2: "0xW2222222222222222222222222222222222222bb",
  loss: "0xL3333333333333333333333333333333333333cc",
  open: "0xO4444444444444444444444444444444444444dd",
};
const WALLET = "0xWALLEThandlerWALLEThandlerWALLEThandle99";
const TXHASH = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef00";

function pos(id: string, handle: string, contract: string, chain: Chain, status: "open" | "closed", pnl: number, when: string): Position {
  return {
    id, postId: "t-" + id, authorXId: "x-" + handle, authorHandle: handle,
    status, entryPriceEth: 0.001, remainingFraction: status === "open" ? 1 : 0,
    tiersHit: status === "open" ? 0 : 2, realisedPnlEth: pnl,
    openedAt: when, closedAt: status === "closed" ? when : undefined,
    entryTxHash: TXHASH,
    order: { contractAddress: contract, chain, amountInEth: 0.1, takeProfits: [{ priceX: 2, sellFraction: 0.5 }], stopLossX: 0.7 },
  };
}

// @alice: 2 wins + 1 loss (qualifies for hit-rate, min sample 3) + 1 open
// @bob:   1 loss only (below min sample)
const positions: Position[] = [
  pos("p-win-1", "@alice", C.win, "base", "closed", 0.30, "2026-02-01T00:00:00Z"),
  pos("p-win-2", "@alice", C.win2, "base", "closed", 0.20, "2026-02-02T00:00:00Z"),
  pos("p-loss-1", "@alice", C.loss, "base", "closed", -0.05, "2026-02-03T00:00:00Z"),
  pos("p-open-1", "@alice", C.open, "base", "open", 0, "2026-02-04T00:00:00Z"),
  pos("p-loss-b", "@bob", C.loss, "base", "closed", -0.10, "2026-02-05T00:00:00Z"),
];

const dists: Distribution[] = [
  { positionId: "p-win-1", totalProfitEth: 0.3, toAuthorEth: 0.075, toPortfolioEth: 0, toTeamEth: 0, toBuybackEth: 0, authorWallet: WALLET },
  { positionId: "p-win-2", totalProfitEth: 0.2, toAuthorEth: 0.05, toPortfolioEth: 0, toTeamEth: 0, toBuybackEth: 0, authorWallet: WALLET },
];

const reviews: ReviewRecord[] = [
  { reviewedAt: "2026-02-01T00:00:00Z", postId: "t-p-win-1", postUrl: "https://x.com/alice/status/1", authorXId: "x-@alice", authorHandle: "@alice", contractAddress: C.win, chain: "base", authorScore: 82, tokenScore: 74, launchpad: "bankr", grade: "A", decision: "BUY", confidence: 0.9, rationale: "strong" },
];

const SYMBOLS: Record<string, string> = {
  [C.win.toLowerCase()]: "WIF",
  [C.win2.toLowerCase()]: "MOON",
  [C.loss.toLowerCase()]: "RUG",
  [C.open.toLowerCase()]: "PEPE",
};

const store = {
  getOpenPositions: async () => positions.filter((p) => p.status === "open"),
  getAllPositions: async () => positions,
  getDistributions: async () => dists,
  getFunnel: async (): Promise<Funnel> => ({ seen: 100, passed: 12 }),
  getReviews: async () => reviews,
} as unknown as Parameters<typeof handleGroupCommand>[1] extends { store?: infer S } ? S : never;

const getSymbol = async (c: string, _chain: Chain) => SYMBOLS[c.toLowerCase()] ?? "";
const deps = { store, getSymbol };

function assertNoSecrets(s: string) {
  assert.ok(!s.includes(WALLET), `SECURITY: wallet leaked → ${s}`);
  assert.ok(!s.includes(TXHASH), `SECURITY: tx-hash leaked → ${s}`);
}

beforeEach(() => clearSymbolCache());

describe("group handler — static commands", () => {
  it("/start lists commands", async () => {
    const r = await handleGroupCommand("/start", deps);
    assert.ok(r && /\/stats/.test(r) && /\/leaderboard/.test(r), r ?? "null");
  });
  it("/how mentions tagging the agent on X", async () => {
    const r = await handleGroupCommand("/how", deps);
    assert.ok(r && /@thesis_agent/i.test(r), r ?? "null");
  });
  it("/links includes the site + a never-DM safety note", async () => {
    const r = await handleGroupCommand("/links", deps);
    assert.ok(r && /thesisonbase\.com/.test(r) && /never/i.test(r), r ?? "null");
  });
  it("/rules returns rules text", async () => {
    const r = await handleGroupCommand("/rules", deps);
    assert.ok(r && r.length > 0, r ?? "null");
  });
});

describe("group handler — stats/leaderboard/author (names-only, ETH not Ξ)", () => {
  it("/stats reports win rate + counts in ETH, never Ξ", async () => {
    const r = await handleGroupCommand("/stats", deps);
    assert.ok(r, "null");
    assert.ok(!r!.includes("Ξ"), `no glyph: ${r}`);
    assert.ok(/ETH/.test(r!), `expected ETH ticker: ${r}`);
    assertNoSecrets(r!);
  });
  it("/leaderboard shows both sections, @handles, no addresses", async () => {
    const r = await handleGroupCommand("/leaderboard", deps);
    assert.ok(r, "null");
    assert.ok(/@alice/.test(r!), `top earner @alice: ${r}`);
    assert.ok(/earn/i.test(r!) && /hit|rate/i.test(r!), `both sections: ${r}`);
    assert.ok(!/0x[0-9a-fA-F]{6}/.test(r!), `no raw address in leaderboard: ${r}`);
    assertNoSecrets(r!);
  });
  it("/author @alice shows her earnings + W/L record", async () => {
    const r = await handleGroupCommand("/author @alice", deps);
    assert.ok(r, "null");
    assert.ok(/@alice/.test(r!), r!);
    assert.ok(/2/.test(r!), `2 wins: ${r}`);
    assertNoSecrets(r!);
  });
  it("/author @nobody → graceful no-record", async () => {
    const r = await handleGroupCommand("/author @nobody", deps);
    assert.ok(r && /no/i.test(r), r ?? "null");
  });
});

describe("group handler — recent/open (symbols, names-only)", () => {
  it("/recent shows closed trades with $TICKER + @author, no secrets", async () => {
    const r = await handleGroupCommand("/recent", deps);
    assert.ok(r, "null");
    assert.ok(/WIF|MOON|RUG/.test(r!), `expected a ticker: ${r}`);
    assert.ok(/@alice|@bob/.test(r!), `expected an author: ${r}`);
    assertNoSecrets(r!);
  });
  it("/open links each ticker to a dexscreener chart; no wallet/tx", async () => {
    const r = await handleGroupCommand("/open", deps);
    assert.ok(r, "null");
    assert.ok(/dexscreener\.com\/base\//.test(r!), `expected chart link: ${r}`);
    assert.ok(/PEPE/.test(r!), `expected open ticker PEPE: ${r}`);
    assertNoSecrets(r!);
  });
  it("/open header reports the TRUE total, not the capped list length", async () => {
    const many = Array.from({ length: 16 }, (_, i) =>
      pos(`p-many-${i}`, "@alice", C.open, "base", "open", 0, `2026-03-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
    );
    const bigStore = { ...store, getOpenPositions: async () => many } as typeof store;
    const r = await handleGroupCommand("/open", { store: bigStore, getSymbol });
    assert.ok(r && /\(16, showing 15\)/.test(r), `expected true total + showing note: ${r}`);
  });
});

describe("group handler — /check", () => {
  it("/check WIF finds the review verdict (grade), no contract in plain text", async () => {
    // /check is CACHE-ONLY — warm the symbol the way the notifier would have.
    await resolveSymbol(C.win, "base", { getSymbol });
    const r = await handleGroupCommand("/check WIF", deps);
    assert.ok(r, "null");
    assert.ok(/A\b/.test(r!) && /BUY/i.test(r!), `expected grade+decision: ${r}`);
    assertNoSecrets(r!);
  });
  it("/check on an untracked (uncached) ticker → not-found, no network fan-out", async () => {
    // cache cleared by beforeEach; getSymbol provided but cacheOnly must ignore it
    const calls: string[] = [];
    const spyDeps = { store, getSymbol: async (c: string) => { calls.push(c); return "WIF"; } };
    const r = await handleGroupCommand("/check WIF", spyDeps);
    assert.ok(r && /no tracked review/i.test(r), `expected not-found: ${r}`);
    assert.equal(calls.length, 0, "cache-only /check must not call the network resolver");
  });
  it("/check with no arg → usage hint", async () => {
    const r = await handleGroupCommand("/check", deps);
    assert.ok(r && /ticker|usage|e\.g\./i.test(r), r ?? "null");
  });
  it("/check UNKNOWNTOKEN → not-found guidance", async () => {
    const r = await handleGroupCommand("/check ZZZNOPE", deps);
    assert.ok(r && /no review|not.*found|tag @thesis_agent/i.test(r), r ?? "null");
  });
});

describe("group handler — unknown command is silent", () => {
  it("returns null for an unknown command (no spam)", async () => {
    const r = await handleGroupCommand("/notacommand", deps);
    assert.equal(r, null);
  });
  it("returns null for non-command chatter", async () => {
    const r = await handleGroupCommand("gm everyone", deps);
    assert.equal(r, null);
  });
});
