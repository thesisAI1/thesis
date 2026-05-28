/**
 * Profit-close share card — the SVG that's attached to the X reply when a
 * trade closes in profit. The design (V3, story-focused) was locked with the
 * user; this module is the parameterised renderer.
 *
 * Returns a complete SVG string suitable for rasterisation via `./render.ts`.
 */

/** All the data the card needs. Keep this flat — easier to plug in from the
 *  monitor's exit-reply call site. */
export interface ProfitCardData {
  tokenSymbol: string;
  authorHandle: string;
  /** X profile image URL. Optional — fallback to initials when missing. */
  authorAvatarUrl?: string | null;
  /** Total realised PnL on this trade so far, in ETH. */
  totalProfitEth: number;
  /** % gain on the trade overall (rough — derived by caller). */
  pnlPct: number;
  /** Token market cap (USD) at buy time. Null when unknown. */
  entryMarketCapUsd: number | null;
  /** Token market cap (USD) at the moment of this exit. Null when unknown. */
  exitMarketCapUsd: number | null;
  /** Author's 25% share of THIS exit's profit, in ETH. */
  authorShareEth: number;
  /** Buyback & burn allocation (also 25%), in ETH. */
  buybackEth: number;
  /** Which exit fired — for the headline copy. */
  exit:
    | { kind: "tp"; tier: number; gainPct: number; final: boolean }
    | { kind: "trail"; tiersHit: number }
    | { kind: "manual"; tiersHit: number };
}

/** Build the SVG string for a profit-close card. */
export function renderProfitCardSvg(data: ProfitCardData, avatarDataUri?: string): string {
  const ticker = sanitiseTicker(data.tokenSymbol);
  const handle = data.authorHandle.startsWith("@")
    ? data.authorHandle
    : "@" + data.authorHandle;
  const initials = handle.replace(/^@/, "").slice(0, 2).toUpperCase();

  const pnlEth = formatSignedEth(data.totalProfitEth);
  const pnlPct = formatPct(data.pnlPct);
  const headline = buildHeadline(data, pnlEth);
  const description = buildDescription(data, ticker);

  const entryToExit = formatMcArrow(data.entryMarketCapUsd, data.exitMarketCapUsd);
  const entryToExitPct = formatMcDelta(data.entryMarketCapUsd, data.exitMarketCapUsd);
  const authorShare = formatSignedEth(data.authorShareEth);
  const buyback = formatSignedEth(data.buybackEth);

  const avatarBlock = avatarDataUri
    ? `<g clip-path="url(#avatarClip)"><image href="${escapeAttr(avatarDataUri)}" x="0" y="0" width="40" height="40" preserveAspectRatio="xMidYMid slice"/></g>
       <circle cx="20" cy="20" r="20" fill="none" stroke="#232B3A" stroke-width="1"/>`
    : `<circle cx="20" cy="20" r="20" fill="#534AB7"/>
       <text x="20" y="27" font-size="14" font-weight="600" fill="#EEEDFE" text-anchor="middle" font-family="ui-monospace, Menlo, monospace">${escapeText(initials)}</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="675" viewBox="0 0 1200 675" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" role="img">
<title>THESIS — ${escapeText(ticker)} closed in profit</title>
<desc>Trade close share card. ${escapeText(handle)} earned ${pnlEth} ETH on ${escapeText(ticker)}.</desc>
<defs>
  <style><![CDATA[
    .text { fill: #EAEEF6; font-family: "Helvetica", "Arial", "Liberation Sans", "DejaVu Sans", sans-serif; }
    .muted { fill: #8B97AC; font-family: "Helvetica", "Arial", "Liberation Sans", "DejaVu Sans", sans-serif; }
    .dim { fill: #5C6678; font-family: "Liberation Mono", "DejaVu Sans Mono", monospace; }
    .accent { fill: #E6A33E; }
    .green { fill: #3FB984; }
    .serif { font-family: "Georgia", "Liberation Serif", "DejaVu Serif", serif; }
    .mono { font-family: "Liberation Mono", "DejaVu Sans Mono", monospace; }
  ]]></style>
  <clipPath id="avatarClip"><circle cx="20" cy="20" r="20"/></clipPath>
</defs>

<rect x="0" y="0" width="1200" height="675" fill="#080A10"/>

<g transform="translate(60, 60)">
  <circle cx="22" cy="22" r="20" fill="none" stroke="#E6A33E" stroke-width="2"/>
  <text x="22" y="32" class="accent serif" font-size="26" font-weight="700" text-anchor="middle">&#920;</text>
  <text x="58" y="20" class="text" font-size="22" font-weight="700">THESIS</text>
  <text x="58" y="40" class="dim" font-size="11" letter-spacing="2">COMMITTEE · BASE</text>
</g>

<rect x="1015" y="62" width="125" height="32" rx="8" fill="#0E2820" stroke="#3FB984" stroke-width="1"/>
<text x="1078" y="84" class="green mono" font-size="12" font-weight="700" letter-spacing="2" text-anchor="middle">PROFIT CLOSE</text>

<text x="60" y="200" class="accent serif" font-size="44" font-weight="700">${escapeText(headline.line1)}</text>
<text x="60" y="252" class="text serif" font-size="44" font-weight="700">${headline.line2Svg}</text>

<text x="60" y="310" class="muted" font-size="18">${description.l1Svg}</text>
<text x="60" y="338" class="muted" font-size="18">${description.l2Svg}</text>
<text x="60" y="366" class="muted" font-size="18"><tspan class="green" font-weight="600">25% of the profit</tspan> sent on-chain to the author. Automatic.</text>

<g transform="translate(60, 420)">
  <rect x="0" y="0" width="350" height="120" rx="14" fill="#11151F" stroke="#232B3A" stroke-width="1"/>
  <text x="22" y="32" class="dim" font-size="11" letter-spacing="2">ENTRY &#x2192; EXIT</text>
  <text x="22" y="78" class="text mono" font-size="26" font-weight="700">${escapeText(entryToExit)}</text>
  <text x="22" y="102" class="green mono" font-size="14" font-weight="600">${escapeText(entryToExitPct)}</text>

  <rect x="370" y="0" width="350" height="120" rx="14" fill="#11151F" stroke="#232B3A" stroke-width="1"/>
  <text x="392" y="32" class="dim" font-size="11" letter-spacing="2">AUTHOR EARNED</text>
  <text x="392" y="78" class="green mono" font-size="26" font-weight="700">${escapeText(authorShare)} &#926;</text>
  <text x="392" y="102" class="muted mono" font-size="14">25% of trade profit</text>

  <rect x="740" y="0" width="365" height="120" rx="14" fill="#11151F" stroke="#232B3A" stroke-width="1"/>
  <text x="762" y="32" class="dim" font-size="11" letter-spacing="2">$THESIS BURNED</text>
  <text x="762" y="78" class="accent mono" font-size="26" font-weight="700">${escapeText(buyback)} &#926;</text>
  <text x="762" y="102" class="muted mono" font-size="14">25% buyback &amp; burn</text>
</g>

<g transform="translate(60, 605)">
  ${avatarBlock}
  <text x="52" y="18" class="text" font-size="16" font-weight="600">${escapeText(handle)} &#x2014; thesis author</text>
  <text x="52" y="38" class="dim" font-size="11" letter-spacing="1">YOU PITCH THE READ. THE COMMITTEE TRADES IT.</text>
</g>
<text x="1140" y="618" class="dim" font-size="12" letter-spacing="1" text-anchor="end">thesisonbase.com</text>
<text x="1140" y="638" class="dim" font-size="12" letter-spacing="1" text-anchor="end">@thesis_agent</text>
</svg>`;
}

function buildHeadline(d: ProfitCardData, pnlEth: string): {
  line1: string;
  line2Svg: string;
} {
  if (d.exit.kind === "trail") {
    return {
      line1: "Trailing stop hit.",
      line2Svg: `<tspan class="green">${escapeText(pnlEth)} &#926;</tspan> banked.`,
    };
  }
  if (d.exit.kind === "manual") {
    return {
      line1: "Closed at author's call.",
      line2Svg: `<tspan class="green">${escapeText(pnlEth)} &#926;</tspan> banked.`,
    };
  }
  if (d.exit.final) {
    return {
      line1: "Full ladder cleared.",
      line2Svg: `<tspan class="green">${escapeText(pnlEth)} &#926;</tspan> total.`,
    };
  }
  return {
    line1: `Take-profit TP${d.exit.tier} hit.`,
    line2Svg: `<tspan class="green">${escapeText(pnlEth)} &#926;</tspan> shared.`,
  };
}

function buildDescription(d: ProfitCardData, ticker: string): {
  l1Svg: string;
  l2Svg: string;
} {
  const entry = d.entryMarketCapUsd != null ? formatMc(d.entryMarketCapUsd) : "—";
  const exit = d.exitMarketCapUsd != null ? formatMc(d.exitMarketCapUsd) : "—";
  const pctTxt = d.pnlPct >= 0 ? `+${d.pnlPct.toFixed(1)}%` : `${d.pnlPct.toFixed(1)}%`;
  const handle = d.authorHandle.startsWith("@") ? d.authorHandle : "@" + d.authorHandle;
  return {
    l1Svg: `Author <tspan class="text" font-weight="600">${escapeText(handle)}</tspan> spotted <tspan class="accent" font-weight="600">${escapeText(ticker)}</tspan> at <tspan class="text" font-weight="600">${escapeText(entry)} mcap</tspan>.`,
    l2Svg: `Committee funded it. Position closed at <tspan class="text" font-weight="600">${escapeText(exit)}</tspan> &#x2014; <tspan class="green" font-weight="600">${escapeText(pctTxt)}</tspan>.`,
  };
}

/** Stringify a USD market cap compactly: 120000 -> "$120K". */
function formatMc(usd: number): string {
  if (usd >= 1_000_000) return "$" + (usd / 1_000_000).toFixed(usd >= 10_000_000 ? 0 : 2) + "M";
  if (usd >= 1_000) return "$" + Math.round(usd / 1_000) + "K";
  return "$" + Math.round(usd);
}

function formatMcArrow(entry: number | null, exit: number | null): string {
  if (entry == null && exit == null) return "—";
  if (entry == null) return `? → ${formatMc(exit ?? 0)}`;
  if (exit == null) return `${formatMc(entry)} → ?`;
  return `${formatMc(entry)} → ${formatMc(exit)}`;
}

function formatMcDelta(entry: number | null, exit: number | null): string {
  if (entry == null || exit == null || entry <= 0) return "—";
  const pct = ((exit - entry) / entry) * 100;
  return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
}

function formatSignedEth(eth: number): string {
  return (eth >= 0 ? "+" : "") + eth.toFixed(4);
}

function formatPct(pct: number): string {
  return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
}

function sanitiseTicker(symbol: string): string {
  const s = (symbol || "").trim();
  if (!s) return "$TOKEN";
  return s.startsWith("$") ? s : "$" + s;
}

function escapeText(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c] || c),
  );
}

function escapeAttr(s: string): string {
  return escapeText(s);
}
