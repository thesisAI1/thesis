/**
 * Quote-aware conversion of a DexScreener `priceNative` to a true ETH price.
 *
 * `priceNative` is the token price denominated in the pool's QUOTE token:
 *   - Clanker/Bankr pools are WETH-quoted → priceNative is already ETH (×1).
 *   - A graduated Virtuals token's pool is VIRTUAL-quoted → priceNative is in
 *     VIRTUAL and must be multiplied by the VIRTUAL/ETH rate to become ETH.
 *
 * This is the single seam that keeps `entryPriceEth` (recorded at buy), the
 * monitor's take-profit / stop-loss gates, and the dashboard PnL all in the SAME
 * unit (ETH). Get it wrong and a "2× in VIRTUAL" would fire a tier that isn't a
 * 2× in ETH whenever VIRTUAL drifts against ETH during the hold.
 */

export interface QuoteContext {
  /** The $VIRTUAL token address on this chain (config.chain.virtualToken). */
  virtual: string | null | undefined;
  /** VIRTUAL price in ETH, or null when it could not be resolved this tick. */
  virtualEthRate: number | null;
}

export function toEthPrice(
  priceNative: number,
  quoteAddress: string | null | undefined,
  ctx: QuoteContext,
): number {
  const isVirtualQuoted =
    !!ctx.virtual && quoteAddress?.toLowerCase() === ctx.virtual.toLowerCase();
  // WETH-quoted (Clanker/Bankr) and every other quote keep today's behavior:
  // priceNative is taken as ETH. Only a VIRTUAL-quoted pool needs converting.
  if (!isVirtualQuoted) return priceNative;
  return resolveVirtualPriceEth(priceNative, ctx.virtualEthRate);
}

/**
 * Convert a VIRTUAL-denominated price to ETH.
 *
 * SAFETY POLICY (operator-tunable): when the VIRTUAL/ETH rate can't be resolved
 * (DexScreener hiccup, VIRTUAL momentarily unpriced), we return 0 — the existing
 * "no live price" sentinel. Downstream this means the monitor skips the position
 * and retries next tick, and the dashboard falls back to the entry price. We do
 * NOT pass the raw VIRTUAL price through, because labeling a VIRTUAL price as ETH
 * is exactly the corruption this module exists to prevent. Refusing to act on an
 * unknown price is safer than acting on a wrong one.
 */
function resolveVirtualPriceEth(priceNative: number, virtualEthRate: number | null): number {
  if (virtualEthRate === null || !(virtualEthRate > 0)) return 0;
  return priceNative * virtualEthRate;
}
