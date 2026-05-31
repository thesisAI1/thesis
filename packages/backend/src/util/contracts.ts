import type { Chain } from "@thesis/shared";

/** EVM contract address: 0x + 40 hex. */
const EVM_RE = /0x[a-fA-F0-9]{40}/;
/** Mock posts use a short placeholder address. */
const EVM_MOCK_RE = /0xMOCK\w+/;
/**
 * Solana mint: a base58-encoded 32-byte public key — 32–44 chars from the
 * base58 alphabet (no 0, O, I, l). Word-bounded so it doesn't slice a longer
 * token. EVM is matched FIRST (below), so a zero-free 40-hex address can never
 * be mis-read as base58.
 */
const SOLANA_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;

/** Extract the first contract address found in a post's text. */
export function extractContract(text: string): string | null {
  const evm = text.match(EVM_RE);
  if (evm) return evm[0];
  const mock = text.match(EVM_MOCK_RE);
  if (mock) return mock[0];
  // No EVM address — look for a Solana base58 mint.
  const sol = text.match(SOLANA_RE);
  return sol ? sol[0] : null;
}

/**
 * Best-effort chain guess from an address SHAPE. A 0x address could live on any
 * EVM chain and a base58 string could be any Solana account — the Auditor's
 * DexScreener lookup resolves the real chain and flags / skips the submission
 * if the token isn't actually tradable on a supported chain.
 */
export function guessChain(address: string): Chain {
  if (address.startsWith("0xMOCK")) return "base";
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) return "base";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return "solana";
  return "unknown";
}
