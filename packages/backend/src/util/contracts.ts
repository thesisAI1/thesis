import type { Chain } from "@thesis/shared";

/** Extract the first contract address found in a post's text. */
export function extractContract(text: string): string | null {
  const evm = text.match(/0x[a-fA-F0-9]{40}/);
  if (evm) return evm[0];
  // Mock posts use a short placeholder address.
  const mock = text.match(/0xMOCK\w+/);
  return mock ? mock[0] : null;
}

/**
 * Best-effort chain guess from an address shape. A 0x address could live on
 * any EVM chain — the Auditor's on-chain lookup resolves the real chain and
 * flags the submission if the token is not actually on Base.
 */
export function guessChain(address: string): Chain {
  if (address.startsWith("0xMOCK")) return "base";
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) return "base";
  return "unknown";
}
