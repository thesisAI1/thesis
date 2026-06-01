import type { Chain } from "@thesis/shared";

/**
 * Per-chain trusted launchpads.
 *
 * The Auditor's hard gate trusts only launchpads that deploy a standard,
 * audited token + LP, so contract-level honeypot / rug risk is removed:
 *   - Base   → Clanker, Bankr
 *   - Solana → pump.fun ONLY
 *
 * Canonical keys are lowercased, dot-free ("pumpfun"). Anything not in a
 * chain's set fails the gate (Auditor scores it 0 → the buy gate vetoes it).
 */
const TRUSTED: Partial<Record<Chain, string[]>> = {
  base: ["clanker", "bankr"],
  "base-sepolia": ["clanker", "bankr"],
  solana: ["pumpfun"],
};

/** The trusted launchpad keys for a chain (empty for unsupported chains). */
export function trustedLaunchpads(chain: Chain): string[] {
  return TRUSTED[chain] ?? [];
}

/** Normalize a launchpad name to its canonical key (lowercase, dot-free). */
function normalize(launchpad: string): string {
  return launchpad.toLowerCase().replace(/\./g, "");
}

/** True when `launchpad` is a trusted launchpad on `chain`. */
export function isLaunchpadTrusted(
  chain: Chain,
  launchpad: string | null | undefined,
): boolean {
  if (!launchpad) return false;
  return trustedLaunchpads(chain).includes(normalize(launchpad));
}
