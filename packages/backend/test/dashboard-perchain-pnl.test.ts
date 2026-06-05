/**
 * Money-clarity — the dashboard must NOT conflate ETH and SOL into one number.
 *
 * Incident this pins — 2026-06-05 dashboard:
 *   realised PnL, "paid to authors", "buyback & burn" and the leaderboard all
 *   summed each position's native amount across chains as if 1 SOL == 1 ETH.
 *   A −0.3 SOL Solana loss showed up as −0.3 ETH on the Base figures, and a
 *   Solana author's share was double-counted into the ETH "paid to authors"
 *   total. The natives are different coins and can never be summed.
 *
 * Defence pinned here: /api/dashboard splits every native figure by chain.
 *   - portfolio.realizedPnlByChain.{base,solana}
 *   - distributions.byChain.{base,solana}.{toAuthors,toPortfolio,toBuyback}
 *   - counters.{authors,buyback,portfolio}TotalByChain.{base,solana}
 * The Base value must carry ONLY Base positions' ETH and the Solana value ONLY
 * Solana positions' SOL — never the cross-chain sum.
 */

import "./helpers/isolate-store.js"; // temp DATA_DIR + mock mode before config loads
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Position, Distribution } from "@thesis/shared";
import { handle, _resetDashboardCacheForTest } from "../src/server/index.js";
import { getStore } from "../src/store/index.js";
import { __setChainForTest } from "../src/adapters/chain/index.js";

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

function closedPosition(opts: {
  id: string;
  chain: "base" | "solana";
  realisedPnlEth: number;
}): Position {
  return {
    id: opts.id,
    postId: `${opts.id}-post`,
    authorXId: `${opts.id}-author`,
    authorHandle: `@${opts.id}`,
    postUrl: `https://x.com/${opts.id}/status/${opts.id}`,
    order: {
      contractAddress: `0x${opts.id}`,
      chain: opts.chain,
      amountInEth: 0.1,
      takeProfits: [{ priceX: 2, sellFraction: 1 }],
      stopLossX: 0.7,
    },
    status: "closed",
    entryPriceEth: 1e-6,
    entryTokens: 100_000,
    entryTxHash: "0xentry",
    remainingFraction: 0,
    tiersHit: 1,
    realisedPnlEth: opts.realisedPnlEth,
    openedAt: new Date().toISOString(),
    closedAt: new Date().toISOString(),
  };
}

function distribution(positionId: string, share: number): Distribution {
  return {
    positionId,
    totalProfitEth: share * 4,
    toAuthorEth: share,
    toPortfolioEth: share * 2,
    toBuybackEth: share,
    authorWallet: null,
  };
}

interface Body {
  portfolio: { realizedPnlEth: number; realizedPnlByChain: { base: number; solana: number } };
  distributions: {
    toAuthors: number;
    toBuyback: number;
    byChain: {
      base: { toAuthors: number; toPortfolio: number; toBuyback: number };
      solana: { toAuthors: number; toPortfolio: number; toBuyback: number };
    };
  };
  counters: {
    authorsTotalByChain: { base: number; solana: number };
    buybackTotalByChain: { base: number; solana: number };
  };
}

// Fixed USD rates so the cross-chain USD total is deterministic. Stubbed in
// beforeEach so the very first getUsdRate() call caches THESE values (the cache
// has a 5-min TTL and no exported reset), keeping every test in the file stable.
const ETH_RATE = 3000;
const SOL_RATE = 200;

function stubFetchRates(): typeof globalThis.fetch {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("coingecko.com") && url.includes("ids=ethereum")) {
      return new Response(JSON.stringify({ ethereum: { usd: ETH_RATE } }), { status: 200 });
    }
    if (url.includes("coingecko.com") && url.includes("ids=solana")) {
      return new Response(JSON.stringify({ solana: { usd: SOL_RATE } }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as typeof globalThis.fetch;
  return orig;
}

let _origFetch = globalThis.fetch;

beforeEach(() => {
  _resetDashboardCacheForTest();
  _origFetch = globalThis.fetch;
  stubFetchRates();
});

afterEach(() => {
  __setChainForTest(null);
  globalThis.fetch = _origFetch;
});

test("dashboard splits realised PnL and distributions by chain — never SOL+ETH summed", async () => {
  const store = getStore();
  // A Base WIN (+0.4 ETH) and a Solana LOSS (−0.3 SOL). If conflated the Base
  // realised figure would read +0.1 (0.4 + −0.3); split correctly it reads
  // +0.4 ETH on Base and −0.3 SOL on Solana.
  await store.savePosition(closedPosition({ id: "win-base", chain: "base", realisedPnlEth: 0.4 }));
  await store.savePosition(closedPosition({ id: "loss-sol", chain: "solana", realisedPnlEth: -0.3 }));

  // Author share: 0.05 ETH on the Base win, 0.07 SOL on a Solana win.
  await store.savePosition(closedPosition({ id: "paid-sol", chain: "solana", realisedPnlEth: 0.5 }));
  await store.saveDistribution(distribution("win-base", 0.05));
  await store.saveDistribution(distribution("paid-sol", 0.07));

  const { res, result } = captureRes();
  await handle(getReq("/api/dashboard"), res);
  const { status, body } = result();
  assert.equal(status, 200);

  const { portfolio, distributions, counters } = body as Body;

  // Realised PnL: Base carries only ETH, Solana only SOL — not the cross-sum.
  assert.equal(portfolio.realizedPnlByChain.base, 0.4, "Base realised PnL must be the ETH-only figure");
  assert.equal(portfolio.realizedPnlByChain.solana, 0.2, "Solana realised PnL must be the SOL-only figure (-0.3 + 0.5)");
  assert.equal(portfolio.realizedPnlEth, 0.4, "legacy realizedPnlEth must equal the Base figure, not the conflated sum");

  // Distributions: the Solana author share must NOT leak into the ETH total.
  assert.equal(distributions.byChain.base.toAuthors, 0.05, "Base author share is ETH-only");
  assert.equal(distributions.byChain.solana.toAuthors, 0.07, "Solana author share is SOL-only");
  assert.equal(distributions.toAuthors, 0.05, "legacy top-level toAuthors must be Base-only (ETH), not 0.12");

  // Counters mirror the same split.
  assert.equal(counters.authorsTotalByChain.base, 0.05);
  assert.equal(counters.authorsTotalByChain.solana, 0.07);
  assert.equal(counters.buybackTotalByChain.solana, 0.07, "Solana buyback leg is SOL-only");
});

test("leaderboard shows each author's ETH and SOL earnings separately + a USD total", async () => {
  const store = getStore();
  // One author with BOTH a Base win (ETH author share) and a Solana win (SOL
  // author share). The leaderboard must keep the two natives separate and
  // report a combined USD total — never an ETH+SOL native sum.
  const basePos = closedPosition({ id: "lb-base", chain: "base", realisedPnlEth: 0.4 });
  const solPos = closedPosition({ id: "lb-sol", chain: "solana", realisedPnlEth: 0.5 });
  // Same author + a funded BUY review so the row surfaces (funded > 0).
  basePos.authorXId = "author-x";
  basePos.authorHandle = "@multi";
  solPos.authorXId = "author-x";
  solPos.authorHandle = "@multi";
  await store.savePosition(basePos);
  await store.savePosition(solPos);
  await store.saveReview({
    reviewedAt: new Date().toISOString(),
    postId: basePos.postId,
    postUrl: basePos.postUrl,
    authorXId: "author-x",
    authorHandle: "@multi",
    contractAddress: basePos.order.contractAddress,
    chain: "base",
    authorScore: 80,
    tokenScore: 80,
    launchpad: null,
    grade: "A",
    decision: "BUY",
    confidence: 0.9,
    rationale: "",
  });
  await store.saveDistribution(distribution("lb-base", 0.05)); // 0.05 ETH
  await store.saveDistribution(distribution("lb-sol", 0.06)); // 0.06 SOL

  const { res, result } = captureRes();
  await handle(getReq("/api/leaderboard"), res);
  const { status, body } = result();
  assert.equal(status, 200);

  const lb = (body as { leaderboard: Array<Record<string, number>> }).leaderboard;
  const row = lb.find((r) => (r as unknown as { xUserId: string }).xUserId === "author-x");
  assert.ok(row, "author must appear on the leaderboard");
  assert.equal(row.totalEarnedEth, 0.05, "ETH earnings reported separately");
  assert.equal(row.totalEarnedSol, 0.06, "SOL earnings reported separately");
  // USD total = 0.05*3000 + 0.06*200 = 150 + 12 = 162 — never 0.11 native-summed.
  assert.ok(
    Math.abs(row.totalEarnedUsd - (0.05 * ETH_RATE + 0.06 * SOL_RATE)) < 1e-6,
    `USD total must combine both natives at their own rate (got ${row.totalEarnedUsd})`,
  );
});
