/**
 * L5 (audit #5) — recorded proceeds must be the ACTUAL on-chain ETH received,
 * not the KyberSwap pre-trade quote.
 *
 * The bug: RealChain.sell/buy returned `built.amountOut` (the router's QUOTE).
 * A quote overstates the real fill by slippage, so the settlement legs (author
 * 25%, buyback, lottery) were sized off ETH that never arrived → over-drawing
 * principal on every close.
 *
 * The fix is `measureEthProceeds`: it brackets the swap between two wallet-
 * balance reads and reports the delta. The quote is STRUCTURALLY unavailable to
 * it (never passed in), so it is impossible for the recorded proceeds to be the
 * quote — the correctness is by construction, and these tests pin the math:
 * positive delta, gas-ate-it clamps to 0, and the swap runs between the reads.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEther } from "viem";
import {
  netReceivedEthWei,
  measureEthProceeds,
  entryPriceEthFromFill,
} from "../src/adapters/chain/proceeds.js";

test("netReceivedEthWei returns the positive wallet delta in wei", () => {
  assert.equal(netReceivedEthWei(100n, 150n), 50n);
  assert.equal(netReceivedEthWei(0n, parseEther("0.3")), parseEther("0.3"));
});

test("netReceivedEthWei clamps a non-positive delta to 0 (never reports negative proceeds)", () => {
  assert.equal(netReceivedEthWei(150n, 100n), 0n); // gas exceeded swap output
  assert.equal(netReceivedEthWei(100n, 100n), 0n); // no change
});

test("measureEthProceeds reports the on-chain delta (after − before), not a quote", async () => {
  const reads = [parseEther("1.0"), parseEther("1.3")]; // 0.3 ETH actually arrived
  let i = 0;
  let swapRanAfterFirstRead = false;
  const result = await measureEthProceeds(
    async () => reads[i++]!,
    async () => {
      swapRanAfterFirstRead = i === 1; // exactly one read happened before the swap
      return "0xtx";
    },
  );
  assert.equal(result.txHash, "0xtx");
  assert.equal(result.amountOut, 0.3);
  assert.ok(swapRanAfterFirstRead, "swap must execute AFTER the pre-balance read");
});

test("measureEthProceeds reports 0 when gas ate the output (never negative)", async () => {
  const before = parseEther("1.0");
  const stale = parseEther("0.999"); // net loss after gas — stays below `before`
  let reads = 0;
  const result = await measureEthProceeds(
    async () => (reads++ === 0 ? before : stale),
    async () => "0xtx",
    { maxReadAttempts: 5, readDelayMs: 0 },
  );
  assert.equal(result.amountOut, 0);
});

test("measureEthProceeds retries past a lagging replica that shows no credit yet", async () => {
  // Alchemy replica lag: the first post-swap read is a block behind and still
  // reports the pre-swap balance (false 0); a later read sees the real credit.
  const before = parseEther("1.0");
  const sequence = [
    before, // pre-swap read
    before, // lagging replica — no credit visible yet (would be a false 0)
    before, // still lagging
    parseEther("1.033"), // replica caught up — 0.033 ETH actually arrived
  ];
  let i = 0;
  const result = await measureEthProceeds(
    async () => sequence[i++]!,
    async () => "0xtx",
    { maxReadAttempts: 5, readDelayMs: 0 },
  );
  assert.equal(result.amountOut, 0.033);
});

test("measureEthProceeds surfaces an alertable warn when retries exhaust with no ETH credit", async () => {
  // Persistent replica lag (or a genuine net-zero sell): the wallet never grows
  // across the whole read budget. The value correctly clamps to 0, but a silent
  // 0 is the original incident — the zero must be SURFACED with the txHash so a
  // stuck replica is grep-able/alertable. Mirrors buy()'s zero-delta warn.
  const before = parseEther("1.0");
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (msg?: unknown) => void warnings.push(String(msg));
  try {
    const result = await measureEthProceeds(
      async () => before, // never grows — every read shows the pre-swap balance
      async () => "0xstuck",
      { maxReadAttempts: 5, readDelayMs: 0 },
    );
    assert.equal(result.amountOut, 0);
  } finally {
    console.warn = realWarn;
  }
  assert.equal(warnings.length, 1, "exactly one warn on the exhausted-retry zero");
  assert.match(warnings[0]!, /no ETH credit/);
  assert.match(warnings[0]!, /0xstuck/); // txHash on the line → on-chain lookup
});

test("measureEthProceeds stays silent when the credit lands (no false alarm)", async () => {
  const reads = [parseEther("1.0"), parseEther("1.3")]; // credit visible immediately
  let i = 0;
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (msg?: unknown) => void warnings.push(String(msg));
  try {
    const result = await measureEthProceeds(async () => reads[i++]!, async () => "0xok");
    assert.equal(result.amountOut, 0.3);
  } finally {
    console.warn = realWarn;
  }
  assert.equal(warnings.length, 0, "a measured credit must not warn");
});

/**
 * The entry price stamped on a position must be the price we ACTUALLY paid
 * (ETH in / tokens received), not a pre-trade oracle read. The oracle returns 0
 * for a token the feed hasn't indexed yet (a fresh Clanker/Bankr launch); a 0
 * baseline makes the monitor's `price >= entryPriceEth × tierX` collapse to
 * `price >= 0` and fire the whole TP ladder on a token that never moved
 * (2026-06-02 $HESTIA). Derived from the fill, it's positive for any real buy.
 */
test("entryPriceEthFromFill is the price actually paid — ETH in / tokens received", () => {
  // The $HESTIA buy: 0.0251 ETH for 98,535,939.79 tokens ⇒ ~2.547e-10 ETH/token.
  const price = entryPriceEthFromFill(0.0251, 98_535_939.79);
  assert.equal(price, 0.0251 / 98_535_939.79);
  assert.ok(price > 0, "a real fill must yield a POSITIVE entry baseline");
});

test("entryPriceEthFromFill is positive whenever any tokens arrived (never the catastrophic 0)", () => {
  assert.ok(entryPriceEthFromFill(0.02, 1) > 0);
  assert.ok(entryPriceEthFromFill(0.0001, 1_000_000_000) > 0);
});

test("entryPriceEthFromFill clamps to 0 only when no tokens were received", () => {
  // Degenerate fallback (router quote also 0); the monitor's own guard then
  // skips such a position rather than evaluating tiers against a 0 baseline.
  assert.equal(entryPriceEthFromFill(0.02, 0), 0);
});
