/**
 * pump.fun launchpad detection for Solana tokens.
 *
 * pump.fun is the ONLY trusted Solana launchpad (the analogue of Clanker/Bankr
 * on Base — it deploys a standard bonding-curve token + LP, removing contract-
 * level honeypot/rug risk). Detection, in order of reliability:
 *
 *   1. Mint-address suffix "pump" — pump.fun's vanity miner ends every mint it
 *      creates with "pump". This survives graduation to PumpSwap/Raydium (the
 *      mint never changes), so it's the most durable signal.
 *   2. DexScreener dexId — "pumpfun" (bonding curve) or "pumpswap" (graduated)
 *      as a fallback for the rare mint that doesn't carry the suffix.
 *
 * Anything else (Raydium-native, LetsBonk, Moonshot, …) returns null → the
 * Auditor scores the token 0 → the buy gate vetoes it. This is intentionally
 * strict: pump.fun only.
 *
 * LIMITATION: the suffix is a heuristic, not a program-authority proof (a
 * vanity address could in theory end "pump" without being a pump.fun mint).
 * Mirrors the pragmatic Clanker deployer-vs-factory check on Base.
 */
export function detectSolanaLaunchpad(
  mint: string,
  dexIds: string[] = [],
): string | null {
  // Case-SENSITIVE: base58 is case-sensitive and pump.fun's vanity miner emits
  // the literal lowercase suffix "pump". A mint ending in "PUMP"/"Pump" is
  // provably NOT a pump.fun mint, so it must not clear the trusted gate.
  if (mint.endsWith("pump")) return "pumpfun";
  // DexScreener dexIds are canonical lowercase, so lowercasing is safe here.
  if (dexIds.some((d) => d.toLowerCase().includes("pump"))) return "pumpfun";
  return null;
}
