/**
 * RealSolanaData.getSnapshotsEth — live-MC snapshot for Solana mints.
 *
 * Stubs globalThis.fetch to return a DexScreener-shaped Solana `pairs`
 * response. Asserts the returned map contains correct priceEth, marketCapUsd,
 * symbol, and logoUrl for a known mint, and that a mint absent from the
 * DexScreener response is simply omitted from the map.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { RealSolanaData } from "../src/adapters/basedata/solana.real.js";

const MINT_A = "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfpump";
const MINT_B = "So11111111111111111111111111111111111111112"; // absent mint

const MOCK_PRICE_NATIVE = "0.00000025";
const MOCK_MARKET_CAP = 1_500_000;
const MOCK_SYMBOL = "PTEST";
const MOCK_LOGO = "https://dd.dexscreener.com/ds-data/tokens/solana/logo.png";

const realFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

before(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("dexscreener.com/latest/dex/tokens")) {
      return json({
        pairs: [
          {
            chainId: "solana",
            baseToken: { address: MINT_A, symbol: MOCK_SYMBOL },
            priceNative: MOCK_PRICE_NATIVE,
            liquidity: { usd: 500_000 },
            marketCap: MOCK_MARKET_CAP,
            info: { imageUrl: MOCK_LOGO },
          },
          // A non-solana pair for the same request — must be filtered out
          {
            chainId: "base",
            baseToken: { address: MINT_A, symbol: MOCK_SYMBOL },
            priceNative: "9999",
            liquidity: { usd: 1 },
            marketCap: 99,
          },
        ],
      });
    }
    return json({}, 404);
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
});

test("getSnapshotsEth: returns correct marketCapUsd for a known mint", async () => {
  const adapter = new RealSolanaData();
  const map = await adapter.getSnapshotsEth([MINT_A, MINT_B]);
  const snap = map.get(MINT_A.toLowerCase());
  assert.ok(snap, "snapshot must exist for MINT_A");
  assert.equal(snap.marketCapUsd, MOCK_MARKET_CAP);
});

test("getSnapshotsEth: priceEth equals priceNative (SOL-denominated)", async () => {
  const adapter = new RealSolanaData();
  const map = await adapter.getSnapshotsEth([MINT_A]);
  const snap = map.get(MINT_A.toLowerCase());
  assert.ok(snap);
  assert.equal(snap.priceEth, Number(MOCK_PRICE_NATIVE));
});

test("getSnapshotsEth: symbol and logoUrl are populated from the pool", async () => {
  const adapter = new RealSolanaData();
  const map = await adapter.getSnapshotsEth([MINT_A]);
  const snap = map.get(MINT_A.toLowerCase());
  assert.ok(snap);
  assert.equal(snap.symbol, MOCK_SYMBOL);
  assert.equal(snap.logoUrl, MOCK_LOGO);
});

test("getSnapshotsEth: mint absent from DexScreener response is omitted from map", async () => {
  const adapter = new RealSolanaData();
  const map = await adapter.getSnapshotsEth([MINT_A, MINT_B]);
  assert.equal(map.has(MINT_B.toLowerCase()), false, "absent mint must not appear in map");
});

test("getSnapshotsEth: map is keyed by lowercased mint address", async () => {
  const adapter = new RealSolanaData();
  const map = await adapter.getSnapshotsEth([MINT_A.toUpperCase()]);
  // DexScreener returns the address in its original case; we key by lowercase
  assert.ok(map.has(MINT_A.toLowerCase()), "key must be lowercased");
});

test("getSnapshotsEth: empty input returns empty map", async () => {
  const adapter = new RealSolanaData();
  const map = await adapter.getSnapshotsEth([]);
  assert.equal(map.size, 0);
});
