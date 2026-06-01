/**
 * Wave 3 — pure Jupiter v6 response parsers (adapters/chain/jupiter-parse.ts).
 *
 * Mirrors tier-b-kyber-parse: pure functions so they can be unit-tested without
 * constructing RealSolanaChain (which needs a keypair + live RPC). They pin the
 * success-shape extraction and the error/missing-field guards.
 *
 * RED until jupiter-parse.ts exists.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseJupiterQuote,
  parseJupiterSwap,
  type JupiterQuote,
  type JupiterSwap,
} from "../src/adapters/chain/jupiter-parse.js";

// --- parseJupiterQuote ---

test("parseJupiterQuote: extracts in/out amounts from a success response", () => {
  const json: JupiterQuote = {
    inputMint: "So11111111111111111111111111111111111111112",
    inAmount: "1000000000",
    outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    outAmount: "25000000",
    otherAmountThreshold: "24000000",
    routePlan: [{ swapInfo: { ammKey: "pool1" }, percent: 100 }],
  };
  const r = parseJupiterQuote(json);
  assert.equal(r.outAmount, "25000000");
  assert.equal(r.inAmount, "1000000000");
  assert.ok(Array.isArray(r.routePlan) && r.routePlan.length > 0);
});

test("parseJupiterQuote: throws on an error response (no route / no liquidity)", () => {
  assert.throws(
    () => parseJupiterQuote({ error: "Could not find any route" } as unknown as JupiterQuote),
    /jupiter/i,
  );
});

test("parseJupiterQuote: throws when outAmount is missing", () => {
  assert.throws(
    () => parseJupiterQuote({ inputMint: "x", outputMint: "y" } as unknown as JupiterQuote),
    /jupiter/i,
  );
});

// --- parseJupiterSwap ---

test("parseJupiterSwap: returns the base64 swapTransaction", () => {
  const json: JupiterSwap = { swapTransaction: "AQID", lastValidBlockHeight: 123 };
  assert.equal(parseJupiterSwap(json).swapTransaction, "AQID");
});

test("parseJupiterSwap: throws when swapTransaction is missing", () => {
  assert.throws(
    () => parseJupiterSwap({ lastValidBlockHeight: 1 } as unknown as JupiterSwap),
    /jupiter/i,
  );
});
