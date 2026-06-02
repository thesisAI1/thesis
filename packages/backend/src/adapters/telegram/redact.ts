export function truncAddr(a: string): string {
  return a.length > 12 ? a.slice(0, 6) + "…" + a.slice(-4) : a;
}

export function redactText(s: string): string {
  return s
    // 1. Telegram bot tokens (most specific, match first)
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot***")
    // 2. 0x-prefixed hex runs of 40+ chars (ETH addresses, tx hashes, and intermediate lengths)
    .replace(/0x[a-fA-F0-9]{40,}/g, (m) => m.slice(0, 6) + "…" + m.slice(-4))
    // 3. Bare hex runs of 64+ chars (no 0x prefix — private-key-shaped)
    //    Use word boundaries so we don't eat into 0x-prefixed matches (already consumed)
    //    and don't touch normal short strings.
    .replace(/\b([a-fA-F0-9]{64,})\b/g, (m) => m.slice(0, 6) + "…" + m.slice(-4))
    // 4. Base58 runs of 32+ chars (Solana addresses 32–44, tx sigs ~88)
    //    Applied AFTER hex rules so a hex string is never mis-identified as base58.
    //    Base58 alphabet excludes 0, O, I, l — use that to distinguish from hex.
    .replace(/\b([1-9A-HJ-NP-Za-km-z]{32,})\b/g, (m) => m.slice(0, 4) + "…" + m.slice(-4));
}
