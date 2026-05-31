/**
 * Tier B fixture-replay test — Birdeye price parser.
 *
 * Feeds synthetic JSON through the REAL BirdeyeBaseData.getPricesEth parser to
 * pin the response shape (`data[addr].value`). A Birdeye API drift (e.g.
 * renaming the field) will fail this test even though mock-mode tests never hit
 * that path.
 *
 * TODO(tier-b): swap in a real captured payload (record with production keys,
 * save to test/fixtures/birdeye-multiprice.json, remove the __synthetic key).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { config } from "../src/config.js";
import { BirdeyeBaseData } from "../src/adapters/basedata/birdeye.js";

const require = createRequire(import.meta.url);
const fixture = require("./fixtures/birdeye-multiprice.json") as {
  success: boolean;
  data: Record<string, { value?: number } | null>;
};

const TEST_ADDR = "0xaabbccddaabbccddaabbccddaabbccddaabbccdd";
const WETH_BASE = "0x4200000000000000000000000000000000000006";
const ETH_USD = 2500;
const TOKEN_USD = 0.05;
const EXPECTED_PRICE_ETH = TOKEN_USD / ETH_USD; // 0.00002

test("BirdeyeBaseData.getPricesEth: parses data[addr].value and converts USD→ETH", async () => {
  const realFetch = globalThis.fetch;
  const realKey = config.baseData.birdeyeKey;

  // Set a non-empty key so the constructor doesn't throw.
  config.baseData.birdeyeKey = "test-birdeye-key";

  // Clear the static price cache so we hit the fetch path.
  // @ts-expect-error accessing private static for test isolation
  BirdeyeBaseData["priceCache"].clear();

  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (urlStr.includes("/defi/multi_price")) {
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // Unexpected URL — fail loudly so the test doesn't silently produce 0.
    throw new Error(`Unexpected fetch in Birdeye test: ${urlStr}`);
  }) as typeof fetch;

  try {
    const adapter = new BirdeyeBaseData();
    const prices = await adapter.getPricesEth([TEST_ADDR]);

    // Pin: the token's priceEth is present and equals TOKEN_USD / ETH_USD.
    assert.ok(prices.has(TEST_ADDR.toLowerCase()), "returned map must contain the test address");
    const priceEth = prices.get(TEST_ADDR.toLowerCase())!;
    assert.ok(
      Math.abs(priceEth - EXPECTED_PRICE_ETH) < 1e-12,
      `expected priceEth ~${EXPECTED_PRICE_ETH}, got ${priceEth}`,
    );

    // Pin: WETH itself must NOT appear in the output (it's just the USD reference).
    assert.ok(
      !prices.has(WETH_BASE.toLowerCase()),
      "WETH sentinel must not leak into the returned prices map",
    );
  } finally {
    globalThis.fetch = realFetch;
    config.baseData.birdeyeKey = realKey;
    // @ts-expect-error accessing private static for test isolation
    BirdeyeBaseData["priceCache"].clear();
  }
});

test("BirdeyeBaseData.getPricesEth: returns empty map when ETH/USD reference is missing", async () => {
  const realFetch = globalThis.fetch;
  const realKey = config.baseData.birdeyeKey;
  config.baseData.birdeyeKey = "test-birdeye-key";
  // @ts-expect-error accessing private static for test isolation
  BirdeyeBaseData["priceCache"].clear();

  // Fixture without WETH — simulates Birdeye omitting the ETH reference.
  const noWethFixture = {
    success: true,
    data: {
      [TEST_ADDR]: { value: TOKEN_USD },
      // WETH deliberately absent
    },
  };

  globalThis.fetch = (async () =>
    new Response(JSON.stringify(noWethFixture), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  try {
    const adapter = new BirdeyeBaseData();
    const prices = await adapter.getPricesEth([TEST_ADDR]);
    // No ETH/USD reference → the parser bails out and returns empty.
    assert.equal(prices.size, 0, "without ETH/USD reference the result must be empty");
  } finally {
    globalThis.fetch = realFetch;
    config.baseData.birdeyeKey = realKey;
    // @ts-expect-error accessing private static for test isolation
    BirdeyeBaseData["priceCache"].clear();
  }
});
