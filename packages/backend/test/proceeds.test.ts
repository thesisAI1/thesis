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
import { netReceivedEthWei, measureEthProceeds } from "../src/adapters/chain/proceeds.js";

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
  const reads = [parseEther("1.0"), parseEther("0.999")]; // net loss after gas
  let i = 0;
  const result = await measureEthProceeds(
    async () => reads[i++]!,
    async () => "0xtx",
  );
  assert.equal(result.amountOut, 0);
});
