/**
 * Virtuals Protocol launchpad detection for Base tokens.
 *
 * Virtuals is a trusted Base launchpad (alongside Clanker/Bankr). A Virtuals
 * agent token that has GRADUATED off the bonding curve has its locked LP on
 * Uniswap V2 paired against $VIRTUAL — so any DexScreener pool whose QUOTE token
 * is VIRTUAL identifies the token as a Virtuals launch. This is a free signal:
 * DexScreener already returns each pool's quoteToken, so no extra call is needed.
 *
 * Clanker/Bankr tokens are WETH-quoted, so they return null here and keep their
 * own detection path (Bankr launch-fee API / Clanker deployer-vs-factory check).
 * Pre-graduation Virtuals tokens have no DEX pool at all and never reach this
 * function — they are out of scope (they trade only via Virtuals' own bonding
 * contract in VIRTUAL, not through any DEX/aggregator).
 *
 * LIMITATION: this trusts the VIRTUAL pairing itself, not a Virtuals-factory
 * authority proof — mirrors the pragmatic Clanker deployer check. A token whose
 * deepest liquidity is a hand-made VIRTUAL pair would also read as "virtuals",
 * but it still has to clear every other Auditor gate on its own merits.
 */

/** The shape we need off a DexScreener pair — just the quote-token address. */
export interface QuotePair {
  quoteToken?: { address?: string | null } | null;
}

export function detectVirtualsLaunchpad(
  pairs: QuotePair[],
  virtualAddress: string | null | undefined,
): "virtuals" | null {
  if (!virtualAddress) return null;
  const target = virtualAddress.toLowerCase();
  const pairedWithVirtual = pairs.some(
    (p) => p.quoteToken?.address?.toLowerCase() === target,
  );
  return pairedWithVirtual ? "virtuals" : null;
}
