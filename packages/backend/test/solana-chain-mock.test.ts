/**
 * Wave 3 — chain-parameterized factory + MockSolanaChain.
 *
 * createChainAdapter(chain) must dispatch by chain family: solana → the Solana
 * adapter, everything else → the existing Base adapter (UNCHANGED — additive).
 * MockSolanaChain mirrors MockChain's pure, seeded behavior so the demo runs $0
 * end-to-end on Solana. Native units are SOL (the `*Eth` fields carry SOL here).
 *
 * RED until the factory accepts a chain and MockSolanaChain exists.
 */

import "./helpers/isolate-store.js"; // mock mode before config loads
import { test } from "node:test";
import assert from "node:assert/strict";
import { createChainAdapter } from "../src/adapters/chain/index.js";
import { guessChain } from "../src/util/contracts.js";

const SOL_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

test("factory: base still returns an EVM mock (0x wallet) — unchanged", () => {
  const base = createChainAdapter("base");
  assert.match(base.getWalletAddress(), /^0x[a-fA-F0-9]{40}$/);
});

test("factory: default arg is base (back-compat with arg-less callers)", () => {
  const def = createChainAdapter();
  assert.match(def.getWalletAddress(), /^0x[a-fA-F0-9]{40}$/);
});

test("factory: solana returns an adapter with a base58 wallet", () => {
  const sol = createChainAdapter("solana");
  const addr = sol.getWalletAddress();
  assert.equal(guessChain(addr), "solana", "mock Solana wallet must be a base58 address");
});

test("MockSolanaChain: buy then quoteSell round-trips to positive SOL value", async () => {
  const sol = createChainAdapter("solana");
  const buy = await sol.buy(SOL_MINT, 0.5);
  assert.ok(buy.amountOut > 0, "buy returns tokens out");
  assert.ok(buy.priceEth > 0, "buy reports a SOL/token price");
  assert.ok(buy.txHash.length > 0);
  const q = await sol.quoteSell(SOL_MINT, buy.amountOut);
  assert.ok(q.proceedsEth > 0, "quoteSell returns positive SOL proceeds");
});

test("MockSolanaChain: sell and sendEth return tx ids; balance is positive", async () => {
  const sol = createChainAdapter("solana");
  const sell = await sol.sell(SOL_MINT, 1000);
  assert.ok(sell.amountOut > 0 && sell.txHash.length > 0);
  const sig = await sol.sendEth("RecipientWa11etMockAddr1111111111111111111", 0.1);
  assert.ok(typeof sig === "string" && sig.length > 0);
  assert.ok((await sol.getWalletBalanceEth()) > 0, "mock portfolio is funded");
});
