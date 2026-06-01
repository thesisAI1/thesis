/**
 * Per-chain native-currency symbol for the UI — the web mirror of the backend's
 * `nativeSymbol` (packages/backend/src/util/chains.ts). THESIS reuses the `*Eth`
 * value fields as NATIVE gas-token units scoped to a position's chain (SOL on
 * Solana, ETH on Base), so a per-row amount must be labelled with the symbol for
 * THAT row's chain.
 *
 * Use this for PER-POSITION / PER-TRADE values (which carry a `chain`). Portfolio
 * and distribution AGGREGATES use the plain word "ETH": they are ETH-denominated
 * sums and, per the backend's escrow design, ETH and SOL are never summed.
 *
 * We render the WORD ("ETH" / "SOL"), never the bare Greek-letter glyph — it
 * reads clearer and unambiguous.
 */
import type { Chain } from "@thesis/shared";

/** Native gas-token ticker: "SOL" on Solana, "ETH" on Base and every other EVM chain. */
export function nativeSymbol(chain: Chain): string {
  return chain === "solana" ? "SOL" : "ETH";
}
