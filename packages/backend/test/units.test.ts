/**
 * Review follow-up — overflow-safe token base-unit conversion (util/units.ts).
 *
 * The Solana adapter must not lose integer precision converting a token amount
 * to base units (the float `amount * 10**decimals` overflows 2^53 for large
 * balances). These pin the exact-integer behavior.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { toBaseUnits } from "../src/util/units.js";

test("exact for small amounts", () => {
  assert.equal(toBaseUnits(1.5, 9), 1_500_000_000n);
  assert.equal(toBaseUnits(0.000000001, 9), 1n);
});

test("exact for large amounts that overflow float * 10**decimals (2^53)", () => {
  // Both products exceed Number.MAX_SAFE_INTEGER (~9.007e15), so the naive
  // float `amount * 10**dec` would lose integer precision; the string path doesn't.
  assert.equal(toBaseUnits(50_000_000, 9), 50_000_000_000_000_000n); // 5e16
  assert.equal(toBaseUnits(12_345_678, 9), 12_345_678_000_000_000n); // ~1.23e16
});

test("truncates beyond the mint's decimals — never rounds UP past the holding", () => {
  // Flooring matters on a sell: rounding up would request more than we own.
  assert.equal(toBaseUnits(1.2345678999, 6), 1_234_567n);
  assert.equal(toBaseUnits(1.9999999, 6), 1_999_999n);
});

test("non-positive / non-finite → 0n", () => {
  assert.equal(toBaseUnits(0, 9), 0n);
  assert.equal(toBaseUnits(-5, 9), 0n);
  assert.equal(toBaseUnits(Number.NaN, 9), 0n);
});
