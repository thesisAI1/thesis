/**
 * Wave 4 — pump.fun detection (adapters/basedata/solana-launchpad.ts).
 *
 * Solana's trusted launchpad is pump.fun ONLY. pump.fun's vanity miner ends
 * mint addresses with "pump" — a signal that survives graduation to
 * PumpSwap/Raydium — with a DexScreener dexId fallback. Anything else (Raydium-
 * native, LetsBonk, Moonshot) is NOT trusted → the Auditor scores it 0.
 *
 * Pure function — RED until solana-launchpad.ts exists.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSolanaLaunchpad } from "../src/adapters/basedata/solana-launchpad.js";

test("mint ending in 'pump' is pumpfun", () => {
  assert.equal(detectSolanaLaunchpad("6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfpump"), "pumpfun");
});

test("dexId pumpswap/pumpfun is pumpfun even without the suffix", () => {
  assert.equal(detectSolanaLaunchpad("SomeMintWithoutSuffix1111111111111111111111", ["pumpswap"]), "pumpfun");
  assert.equal(detectSolanaLaunchpad("SomeMintWithoutSuffix1111111111111111111111", ["pumpfun"]), "pumpfun");
});

test("a raydium-native token (no pump signal) is NOT a trusted launchpad", () => {
  assert.equal(detectSolanaLaunchpad("RaydiumNativeMint1111111111111111111111111", ["raydium"]), null);
});

test("no signal at all → null", () => {
  assert.equal(detectSolanaLaunchpad("PlainMint1111111111111111111111111111111111"), null);
});
