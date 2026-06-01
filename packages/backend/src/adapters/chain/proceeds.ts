/**
 * Measuring REAL swap proceeds — the actual ETH a wallet gained, never the
 * router's pre-trade quote.
 *
 * L5 (audit #5): RealChain.sell recorded `built.amountOut` (the KyberSwap
 * QUOTE) as the proceeds. A quote overstates the real fill by slippage, so the
 * settlement legs (author 25%, buyback, holder lottery) were sized off ETH that
 * never actually arrived in the wallet → over-drawing principal on every close.
 *
 * We measure the NET wallet delta (after − before). Net already accounts for
 * gas — including the Base L1 data fee that `gasUsed × gasPrice` silently omits
 * — so it can only ever UNDERSTATE proceeds, never overstate. For a system that
 * pays out a fraction of "profit", understating is the safe direction: it
 * protects principal, which is exactly what the audit finding demands. Buy-side
 * gas is not netted (cost basis is the gross ETH-in), an accepted, conservative
 * asymmetry; full two-sided gas accounting is a separate refinement.
 */

import { formatEther } from "viem";

/** Clamped wallet ETH delta, in wei. A swap can never legitimately reduce the
 *  wallet's ETH below zero proceeds, so a non-positive delta (gas exceeded the
 *  output, or no change) reports 0 rather than a negative number. Exposed for
 *  direct unit testing of the arithmetic. */
export function netReceivedEthWei(beforeWei: bigint, afterWei: bigint): bigint {
  return afterWei > beforeWei ? afterWei - beforeWei : 0n;
}

export interface SwapProceeds {
  txHash: string;
  /** Actual ETH received (net of gas), in ether units. */
  amountOut: number;
}

/**
 * Run `swap` between two wallet-balance reads and report the ACTUAL ETH gained.
 *
 * `swap` MUST resolve only once its transaction is mined — RealChain.sendSwap
 * awaits the receipt before returning — so the post-swap read observes settled
 * state. The caller is responsible for ensuring no other wallet operation runs
 * concurrently (the process-wide store lock serializes the monitor/close paths,
 * so the delta reflects this swap alone).
 *
 * RESIDUAL GAP: the /admin/* write endpoints (e.g. test-swap) do NOT run under
 * that lock, so an operator firing one DURING a monitor sell could land an ETH
 * credit between the two reads and inflate the measured proceeds. Low-
 * probability + operator-gated; closing it (bringing admin spends under the
 * lock) is part of the deferred monitor-lock rework. A concurrent
 * EXTERNAL transfer into the wallet has the same effect but is negligible given
 * the ~1-block window. Either way this still strictly improves on the old quote
 * (which overstated by slippage on EVERY sell).
 *
 * The quote is deliberately NOT a parameter: proceeds can only come from the
 * measured delta, so it is impossible to regress to the quote without deleting
 * this call.
 */
export async function measureEthProceeds(
  readEthWei: () => Promise<bigint>,
  swap: () => Promise<string>,
  opts?: { maxReadAttempts?: number; readDelayMs?: number },
): Promise<SwapProceeds> {
  const maxReadAttempts = Math.max(1, opts?.maxReadAttempts ?? 5);
  const readDelayMs = Math.max(0, opts?.readDelayMs ?? 2_000);
  const before = await readEthWei();
  const txHash = await swap();
  // The post-swap read is subject to Alchemy read-replica lag: the swap is
  // confirmed on one replica while this read can hit a sibling a block behind
  // that hasn't yet credited the ETH, making after ≈ before → a false 0. Retry
  // until the credit is visible (after > before), mirroring RealChain.buy's
  // balance-after loop. A genuine net-zero sell (gas ≥ output) exhausts the
  // retries and correctly reports 0.
  let after = before;
  for (let attempt = 0; attempt < maxReadAttempts; attempt++) {
    after = await readEthWei();
    if (after > before) break;
    if (attempt < maxReadAttempts - 1) await new Promise((r) => setTimeout(r, readDelayMs));
  }
  return { txHash, amountOut: Number(formatEther(netReceivedEthWei(before, after))) };
}
