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
const MINT_C = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // has price, no MC
const MINT_D = "D1nToXThinPoo111111111111111111111111111111"; // only a thin (sub-floor) pool

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
          // MINT_C: valid price but NO marketCap/fdv — must still be included with marketCapUsd=0.
          // Liquidity is above the trust floor so the MC-absence behaviour is what's under test.
          {
            chainId: "solana",
            baseToken: { address: MINT_C, symbol: "NOMC" },
            priceNative: "0.000001",
            liquidity: { usd: 50_000 },
            // no marketCap, no fdv
          },
          // MINT_D: only a THIN pool (below the min-liquidity floor) printing a
          // fake high price — must be IGNORED for pricing (2026-06-05 $ZERO).
          {
            chainId: "solana",
            baseToken: { address: MINT_D, symbol: "ZERO" },
            priceNative: "999999",
            liquidity: { usd: 100 },
            marketCap: 1_000_000,
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

test("getSnapshotsEth: token with valid price but missing MC is included with marketCapUsd=0", async () => {
  const adapter = new RealSolanaData();
  const map = await adapter.getSnapshotsEth([MINT_C]);
  const snap = map.get(MINT_C.toLowerCase());
  assert.ok(snap, "snapshot must exist for MINT_C even though MC is absent");
  assert.ok(snap.priceEth > 0, "priceEth must be populated");
  assert.equal(snap.marketCapUsd, 0, "marketCapUsd must be 0 when absent, not cause omission");
});

test("getSnapshotsEth: a mint with only a sub-floor (thin) pool is omitted — no phantom price", async () => {
  const adapter = new RealSolanaData();
  const map = await adapter.getSnapshotsEth([MINT_D]);
  assert.equal(
    map.has(MINT_D.toLowerCase()),
    false,
    "a thin pool below the liquidity floor must never set a price (phantom-spike guard)",
  );
});
