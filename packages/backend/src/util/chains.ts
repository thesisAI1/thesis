import type { Chain } from "@thesis/shared";

/**
 * Chain helpers — native unit + block-explorer URLs.
 *
 * THESIS reuses the `*Eth` value fields as NATIVE gas-token units scoped to a
 * position's chain (SOL on Solana, ETH on Base). These helpers turn a position's
 * `chain` into the right symbol and explorer link for X replies, the profit
 * card, and the dashboard. Solana → Solscan; every supported EVM chain →
 * BaseScan (the project trades Base mainnet).
 */

/** True for EVM chains (viem / KyberSwap path); false for Solana. */
export function isEvm(chain: Chain): boolean {
  return (
    chain === "base" ||
    chain === "base-sepolia" ||
    chain === "ethereum" ||
    chain === "bsc"
  );
}

/** Native gas-token ticker, word form ("ETH" / "SOL"). */
export function nativeSymbol(chain: Chain): string {
  return chain === "solana" ? "SOL" : "ETH";
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
