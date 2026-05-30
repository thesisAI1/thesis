/**
 * Dashboard-local formatting helpers. Pure functions shared by the server page
 * and the interactive client components, so a figure renders identically on the
 * SSR pass and after a live refetch.
 */
/** A signed ETH amount to 4dp, e.g. `+0.1640` / `-0.0190`. */
export function fmtEthSigned(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(4)}`;
}

/** A signed percent. Drops decimals past ±100% to match the mockup. */
export function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  const decimals = n >= 100 || n <= -100 ? 0 : 1;
  return `${sign}${n.toFixed(decimals)}%`;
}

/** A compact USD market-cap, e.g. `$1.23M`, `$410K`, `$512`. Null → em dash. */
export function fmtMc(usd: number | null): string {
  if (usd === null) return "—";
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(usd >= 1e7 ? 0 : 2)}M`;
  if (usd >= 1e3) return `$${Math.round(usd / 1e3)}K`;
  return `$${Math.round(usd)}`;
}

/** A grouped USD figure, e.g. `$48,210`. Rounds to whole dollars. */
export function fmtUsd(usd: number): string {
  return `$${Math.round(usd).toLocaleString("en-US")}`;
}

/** Convert a 0-1 rate to a whole-percent string, e.g. 0.73 → `73%`. */
export function fmtRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** A token symbol as `$SYMBOL`. Falls back to a truncated address when the
 *  symbol isn't known yet. */
export function tokenLabel(symbol: string, contractAddress: string): string {
  if (symbol) return `$${symbol}`;
  return truncate(contractAddress);
}

/** Middle-truncate an address, e.g. `0x44fC…7A01`. */
export function truncate(addr: string, lead = 6, tail = 4): string {
  if (addr.length <= lead + tail + 1) return addr;
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

/** Two-letter avatar fallback from an @handle, e.g. `@onchainmaxi` → `ON`. */
export function initials(handle: string): string {
  const clean = handle.replace(/^@/, "");
  return clean.slice(0, 2).toUpperCase();
}

/** Compact "time ago" from an ISO timestamp, e.g. `2m ago`, `1h ago`, `3d ago`.
 *  `now` is injectable so the SSR pass and a client tick agree on the clock. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.max(0, Math.floor((now - then) / 1000));
  if (secs < 60) return secs <= 1 ? "just now" : `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Map an A–F grade (or null) to the CSS-module colour class key. */
export function gradeClass(grade: string | null): string {
  switch (grade) {
    case "A":
      return "gA";
    case "B":
      return "gB";
    case "C":
      return "gC";
    case "D":
      return "gD";
    case "F":
      return "gF";
    default:
      return "gC";
  }
}
