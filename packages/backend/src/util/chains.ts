import type { Chain } from "@thesis/shared";

// nativeSymbol (ETH/SOL word form) is the ONE shared definition (web uses it
// too) — re-exported so backend callers keep importing it from util/chains.
export { nativeSymbol } from "@thesis/shared";

/**
 * Chain helpers — native unit + block-explorer URLs.
 *
 * THESIS reuses the `*Eth` value fields as NATIVE gas-token units scoped to a
 * position's chain (SOL on Solana, ETH on Base). These helpers turn a position's
 * `chain` into the right symbol and explorer link for X replies, the profit
 * card, and the dashboard. Solana → Solscan; every supported EVM chain →
 * BaseScan (the project trades Base mainnet).
 */

/** Every recognised chain — the runtime mirror of the `Chain` union, used by
 *  `asChain` to validate a persisted string. Keep in sync with @thesis/shared. */
const CHAINS: readonly Chain[] = [
  "base",
  "base-sepolia",
  "ethereum",
  "bsc",
  "solana",
  "unknown",
];

/** Narrow a persisted/string value to a `Chain`, throwing on an unrecognised
 *  one. Used at the DB read seam (escrow/registry/payout/pending-buy `chain`
 *  columns) so a corrupt value fails LOUD rather than silently minting a bad
 *  Chain that could mis-route money. */
export function asChain(value: string): Chain {
  if ((CHAINS as readonly string[]).includes(value)) return value as Chain;
  throw new Error(`invalid chain value: ${JSON.stringify(value)}`);
}

/** True for EVM chains (viem / KyberSwap path); false for Solana. */
export function isEvm(chain: Chain): boolean {
  return (
    chain === "base" ||
    chain === "base-sepolia" ||
    chain === "ethereum" ||
    chain === "bsc"
  );
}

/** Native gas-token glyph, for compact UI/ticker strings ("Ξ" / "◎"). */
export function nativeGlyph(chain: Chain): string {
  return chain === "solana" ? "◎" : "Ξ";
}

const SOLSCAN = "https://solscan.io";
const BASESCAN = "https://basescan.org";

/** Block-explorer URL for a transaction hash / signature. */
export function explorerTxUrl(chain: Chain, hash: string): string {
  return chain === "solana" ? `${SOLSCAN}/tx/${hash}` : `${BASESCAN}/tx/${hash}`;
}

/** Block-explorer URL for a wallet / account address. */
export function explorerAddrUrl(chain: Chain, address: string): string {
  return chain === "solana"
    ? `${SOLSCAN}/account/${address}`
    : `${BASESCAN}/address/${address}`;
}

/** Block-explorer URL for a token / mint. */
export function explorerTokenUrl(chain: Chain, address: string): string {
  return chain === "solana"
    ? `${SOLSCAN}/token/${address}`
    : `${BASESCAN}/token/${address}`;
}
