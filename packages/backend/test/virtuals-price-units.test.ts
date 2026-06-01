/**
 * Quote-aware price units (adapters/basedata/price-units.ts).
 *
 * DexScreener's `priceNative` is the token price IN THE POOL'S QUOTE TOKEN.
 * Clanker/Bankr pools are WETH-quoted, so priceNative is already ETH. A graduated
 * Virtuals token's pool is VIRTUAL-quoted, so priceNative is price-in-VIRTUAL and
 * must be multiplied by the VIRTUAL/ETH rate to become a true ETH price.
 *
 * Getting this wrong corrupts entryPriceEth (recorded at buy) and the monitor's
 * take-profit / stop-loss gates, which compare a live price against entry — so the
 * conversion MUST be consistent for both, and MUST NOT silently treat an
 * un-convertible VIRTUAL price as if it were ETH.
 *
 * Pure function — RED until price-units.ts exists.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { toEthPrice } from "../src/adapters/basedata/price-units.js";

const VIRTUAL = "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b";
const WETH = "0x4200000000000000000000000000000000000006";

test("WETH-quoted price (Clanker/Bankr) is unchanged — already ETH", () => {
  assert.equal(toEthPrice(0.0005, WETH, { virtual: VIRTUAL, virtualEthRate: 0.0002 }), 0.0005);
});

test("an unknown non-VIRTUAL quote is left as-is (existing behavior preserved)", () => {
  const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  assert.equal(toEthPrice(1.23, usdc, { virtual: VIRTUAL, virtualEthRate: 0.0002 }), 1.23);
});

test("VIRTUAL-quoted price is converted to ETH via the VIRTUAL/ETH rate", () => {
  // token = 3 VIRTUAL each, VIRTUAL = 0.0002 ETH each → 0.0006 ETH per token.
  // (float-tolerant: 3 * 0.0002 = 0.0006000000000000001 in IEEE-754.)
  const got = toEthPrice(3, VIRTUAL, { virtual: VIRTUAL, virtualEthRate: 0.0002 });
  assert.ok(Math.abs(got - 0.0006) < 1e-15, `expected ~0.0006, got ${got}`);
});

test("VIRTUAL quote match is case-insensitive", () => {
  assert.equal(
    toEthPrice(2, VIRTUAL.toLowerCase(), { virtual: VIRTUAL, virtualEthRate: 0.0005 }),
    0.001,
  );
});

test("VIRTUAL-quoted but rate unavailable → 0 (no-price sentinel, never mislabel VIRTUAL as ETH)", () => {
  // 0/≤0 is the existing "no live price" sentinel: the monitor skips & retries,
  // the dashboard falls back to entry — far safer than treating VIRTUAL as ETH.
  assert.equal(toEthPrice(3, VIRTUAL, { virtual: VIRTUAL, virtualEthRate: null }), 0);
  assert.equal(toEthPrice(3, VIRTUAL, { virtual: VIRTUAL, virtualEthRate: 0 }), 0);
  assert.equal(toEthPrice(3, VIRTUAL, { virtual: VIRTUAL, virtualEthRate: -1 }), 0);
});

test("VIRTUAL config unset → token can't be VIRTUAL-quoted, price passes through", () => {
  assert.equal(toEthPrice(3, VIRTUAL, { virtual: "", virtualEthRate: null }), 3);
  assert.equal(toEthPrice(3, VIRTUAL, { virtual: undefined, virtualEthRate: null }), 3);
});
