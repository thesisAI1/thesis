/**
 * The web's native-currency-symbol import point. `nativeSymbol` itself lives in
 * @thesis/shared — ONE definition shared with the backend so the two can't
 * drift. This module re-exports it and documents the web's USAGE policy:
 *
 *   - PER-ROW values (a position / trade carries a `chain`) use
 *     `nativeSymbol(chain)` → "ETH" on Base, "SOL" on Solana.
 *   - AGGREGATES (portfolio, paid-to-authors, equity axis, leaderboard totals)
 *     render the plain word "ETH": they are ETH-denominated sums, and ETH and
 *     SOL are never summed.
 *
 * We always render the WORD ("ETH" / "SOL"), never the bare Greek-letter glyph.
 */
export { nativeSymbol } from "@thesis/shared";
