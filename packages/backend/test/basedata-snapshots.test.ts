/**
 * RealBaseData.getSnapshotsEth — re-query ladder (30→8→2→1 chunk sizes).
 *
 * Stubs globalThis.fetch to simulate DexScreener's "30 pairs total" response
 * cap: the first pass (chunk size 30) returns pairs for only a SUBSET of the
 * requested tokens; later/smaller-chunk passes return the rest. Asserts that
 * getSnapshotsEth resolves ALL requested addresses across passes — none are
 * silently dropped.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { RealBaseData } from "../src/adapters/basedata/real.js";

// Ten addresses — enough that a "30 pairs" cap on the first 30-token chunk
// returns only 3 of them (simulating 3 tokens × 10 pools each), forcing
// the adapter to re-query the remaining 7 through smaller chunk sizes.
const ADDRS = [
  "0xaaa0000000000000000000000000000000000001",
  "0xaaa0000000000000000000000000000000000002",
  "0xaaa0000000000000000000000000000000000003",
  "0xaaa0000000000000000000000000000000000004",
  "0xaaa0000000000000000000000000000000000005",
  "0xaaa0000000000000000000000000000000000006",
  "0xaaa0000000000000000000000000000000000007",
  "0xaaa0000000000000000000000000000000000008",
  "0xaaa0000000000000000000000000000000000009",
  "0xaaa000000000000000000000000000000000000a",
];

// ADDRS[0..2] come back on the first (30-token) pass; the rest need smaller chunks.
const FIRST_PASS_ADDRS = new Set(ADDRS.slice(0, 3));

const realFetch = globalThis.fetch;

function pairFor(addr: string) {
  return {
    chainId: "base",
    baseToken: { address: addr, symbol: `T${addr.slice(-1)}` },
    quoteToken: { address: "0x4200000000000000000000000000000000000006" }, // WETH
    priceNative: "0.001",
    liquidity: { usd: 100_000 },
    marketCap: 5_000_000,
    info: { imageUrl: `https://example.com/${addr}.png` },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

before(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.includes("dexscreener.com/latest/dex/tokens")) return json({}, 404);

    // Parse which addresses were requested from the URL path segment
    const segment = url.split("/tokens/")[1] ?? "";
    const requested = segment.split(",").map((a) => a.toLowerCase());

    // Simulate the 30-pair cap: on large (multi-address) requests, return
    // pairs only for the FIRST_PASS_ADDRS subset. Single-address requests
    // always return the pair (chunk size 1 can never be capped below 1 token).
    const toReturn =
      requested.length > 1
        ? requested.filter((a) => FIRST_PASS_ADDRS.has(a))
        : requested;

    return json({ pairs: toReturn.map(pairFor) });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
});

test("getSnapshotsEth: re-query ladder resolves all addresses despite 30-pair cap on first pass", async () => {
  const adapter = new RealBaseData();
  const map = await adapter.getSnapshotsEth(ADDRS);

  for (const addr of ADDRS) {
    const snap = map.get(addr.toLowerCase());
    assert.ok(snap, `snapshot must exist for ${addr} — should not be silently dropped by DexScreener cap`);
    assert.ok(snap.priceEth > 0, `priceEth must be > 0 for ${addr}`);
    assert.equal(snap.marketCapUsd, 5_000_000, `marketCapUsd must be populated for ${addr}`);
  }

  assert.equal(map.size, ADDRS.length, "map must contain exactly all requested addresses");
});

test("getSnapshotsEth: tokens resolved on first pass have correct data", async () => {
  const adapter = new RealBaseData();
  const map = await adapter.getSnapshotsEth(ADDRS.slice(0, 3));

  for (const addr of ADDRS.slice(0, 3)) {
    const snap = map.get(addr.toLowerCase());
    assert.ok(snap, `snapshot must exist for ${addr}`);
    assert.equal(snap.priceEth, 0.001);
    assert.equal(snap.symbol, `T${addr.slice(-1)}`);
    assert.ok(snap.logoUrl?.includes(addr), "logoUrl must reference the token address");
  }
});
