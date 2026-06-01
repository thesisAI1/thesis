import type { Position } from "@thesis/shared";

/**
 * Position token sizing — the single source of truth for "how many tokens does
 * this position correspond to", used by every consumer (tier sells, the author
 * close-profit gate, dashboard valuation) so they can never drift.
 *
 * Sized off the tokens ACTUALLY delivered at entry (`entryTokens`, the measured
 * on-chain balance delta), NOT the market-mid cost-basis estimate. For a
 * dynamic-pricing / transfer-tax token (Doppler/Bankr) the market mid implies
 * MORE tokens than the wallet ever received, so `amountInEth / entryPriceEth`
 * overstates the bag by the delivery-shortfall ratio. Any consumer that uses
 * that estimate overcounts — a tier oversells, the close gate misjudges profit,
 * the dashboard inflates unrealised PnL (incident 2026-06-01 @GamerGuyz5).
 *
 * Legacy positions opened before `entryTokens` was recorded fall back to the
 * cost-basis estimate so they still resolve — they just can't benefit from the
 * delivery correction.
 */

/** Tokens corresponding to `costEth` of the original entry spend. */
export function tokensForCost(pos: Position, costEth: number): number {
  if (pos.order.amountInEth <= 0) return 0;
  const originalTokens =
    pos.entryTokens != null && pos.entryTokens > 0
      ? pos.entryTokens
      : pos.entryPriceEth > 0
        ? pos.order.amountInEth / pos.entryPriceEth
        : 0;
  // costEth / amountInEth is the fraction of the original bag this slice covers.
  return originalTokens * (costEth / pos.order.amountInEth);
}

/** Tokens still held = the slice of the original bag not yet sold. */
export function tokensRemaining(pos: Position): number {
  return tokensForCost(pos, pos.order.amountInEth * pos.remainingFraction);
}
