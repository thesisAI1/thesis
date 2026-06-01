/**
 * Wave 4 — chain-parameterized token-data factory + MockSolanaData.
 *
 * createBaseDataAdapter(chain) must dispatch solana → the Solana data adapter,
 * else → the existing Base adapter (UNCHANGED). MockSolanaData returns a
 * Solana-chain snapshot; a pump.fun mint (ends "pump") reads launchpad
 * "pumpfun" so it clears the Auditor gate.
 *
 * RED until the factory accepts a chain and MockSolanaData exists.
 */

import "./helpers/isolate-store.js"; // mock mode before config loads
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBaseDataAdapter } from "../src/adapters/basedata/index.js";

const PUMP_MINT = "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfpump";
const EVM = "0x36e807119529E44d6F36aD5CE24AeB87a4529ba3";

test("factory: base still returns a Base snapshot (unchanged)", async () => {
  const token = await createBaseDataAdapter("base").getToken(EVM);
  assert.equal(token.chain, "base");
});

test("factory: default arg is base (arg-less callers unchanged)", async () => {
  const token = await createBaseDataAdapter().getToken(EVM);
  assert.equal(token.chain, "base");
});

test("MockSolanaData: getToken returns a solana-chain snapshot", async () => {
  const token = await createBaseDataAdapter("solana").getToken(PUMP_MINT);
  assert.equal(token.chain, "solana");
  assert.ok(token.priceEth > 0, "price (in SOL) is positive");
  assert.ok(token.marketCapUsd > 0);
});

test("MockSolanaData: a 'pump' mint reads launchpad pumpfun", async () => {
  const token = await createBaseDataAdapter("solana").getToken(PUMP_MINT);
  assert.equal(token.launchpad, "pumpfun");
});

test("MockSolanaData: price + symbol helpers work", async () => {
  const sol = createBaseDataAdapter("solana");
  assert.ok((await sol.getPriceEth(PUMP_MINT)) > 0);
  const prices = await sol.getPricesEth([PUMP_MINT]);
  assert.ok((prices.get(PUMP_MINT.toLowerCase()) ?? 0) > 0);
  assert.ok((await sol.getTokenSymbol(PUMP_MINT)).length > 0);
});
