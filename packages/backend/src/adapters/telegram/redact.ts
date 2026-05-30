export function truncAddr(a: string): string {
  return a.length > 12 ? a.slice(0, 6) + "…" + a.slice(-4) : a;
}

export function redactText(s: string): string {
  return s
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot***")
    .replace(/0x[a-fA-F0-9]{40,64}/g, (m) => m.slice(0, 6) + "…" + m.slice(-4));
}
