/**
 * Wave 1 — Solana address parsing in util/contracts.ts.
 *
 * THESIS adds Solana coverage alongside Base. The front door (triage) extracts
 * a contract from the tweet and guesses its chain by address SHAPE. Today both
 * helpers are EVM-only: a Solana base58 mint is never extracted and always
 * guesses `unknown`, so a Solana thesis can't even enter the pipeline.
 *
 * These pin the ADDED behavior. They FAIL against the pre-Solana code (RED) —
 * that failure is the proof Solana submissions are dropped — and PASS once the
 * base58 support lands (GREEN). Existing EVM behavior must stay identical
 * (additive, not a switch).
 *
 * Pure helpers — no store/config, so no isolate-store import needed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractContract, guessChain } from "../src/util/contracts.js";

// USDC on Solana — a real, valid 44-char base58 mint (no 0/O/I/l).
const SOL_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const EVM_ADDR = "0x36e807119529E44d6F36aD5CE24AeB87a4529ba3";

// --- guessChain -------------------------------------------------------------

test("guessChain: EVM 0x…40 still guesses base (unchanged)", () => {
  assert.equal(guessChain(EVM_ADDR), "base");
});

test("guessChain: 0xMOCK placeholder still guesses base (unchanged)", () => {
  assert.equal(guessChain("0xMOCK1234"), "base");
});

test("guessChain: a base58 32–44 mint guesses solana", () => {
  assert.equal(guessChain(SOL_MINT), "solana");
});

test("guessChain: too-short base58 (<32) is unknown, not solana", () => {
  assert.equal(guessChain("abc123"), "unknown");
});

test("guessChain: too-long base58 (>44) is unknown", () => {
  assert.equal(guessChain("E".repeat(45)), "unknown");
});

// --- extractContract --------------------------------------------------------

test("extractContract: finds a Solana mint in tweet text", () => {
  const text = `@thesisonbase strong community, CA: ${SOL_MINT} send it`;
  assert.equal(extractContract(text), SOL_MINT);
});

test("extractContract: prefers the EVM address when both shapes appear", () => {
  const text = `${EVM_ADDR} or ${SOL_MINT}`;
  assert.equal(extractContract(text), EVM_ADDR);
});

test("extractContract: returns null when no address present", () => {
  assert.equal(extractContract("just a thesis with no contract address"), null);
});

test("extractContract: round-trips through guessChain to solana", () => {
  const found = extractContract(`look at ${SOL_MINT}`);
  assert.ok(found);
  assert.equal(guessChain(found), "solana");
});
