/**
 * Public group command handler — the read-only command surface for the
 * community bot (@thesistradebot). Pure: (text, deps) -> Promise<string | null>.
 * `null` means "no reply" (unknown command / chatter) — the poller stays silent
 * so the bot can't be used to spam the group.
 *
 * SAFETY (load-bearing): output is NAMES-ONLY. Never a wallet, never a tx-hash.
 * The ONLY contract that appears is inside an /open chart link (the buy was
 * already announced publicly, so the token itself is not a secret). Every
 * dynamic value (author handle, token symbol, user arg) is HTML-escaped.
 *
 * Currency is always the per-chain ticker via nativeSymbol ("ETH" / "SOL") —
 * never the Ξ glyph — and amounts are grouped per chain (ETH and SOL are
 * different currencies and are never summed into one number).
 */

import type { Chain, ReviewRecord } from "@thesis/shared";
import { nativeSymbol } from "@thesis/shared";
import { getStore } from "../../store/index.js";
import { chartUrl } from "../../util/chains.js";
import { parseCommand } from "./parse.js";
import { resolveSymbol, pnlPct } from "./enrich.js";
import type { StoreReads } from "./commands.js";

// Bounds — public commands must not amplify into unbounded store scans or
// external symbol lookups. With the per-user cooldown in the poller these caps
// keep any single invocation cheap.
const OPEN_LIMIT = 15;
const RECENT_LIMIT = 10;
const LEADER_TOP = 10;
const HITRATE_MIN_SAMPLE = 3;

// ── HTML helpers ──────────────────────────────────────────────────────────────
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** "0.1234 ETH + 2.5 SOL" — per chain, never summed across chains. Empty (no
 *  activity, or all break-even) → chain-neutral "0" rather than guessing a unit. */
function fmtByChain(byChain: Map<Chain, number>): string {
  const parts = [...byChain.entries()]
    .filter(([, v]) => v !== 0)
    .map(([chain, v]) => `${v.toFixed(4)} ${nativeSymbol(chain)}`);
  return parts.length > 0 ? parts.join(" + ") : "0";
}

/** Strip a leading @, lowercase, and validate against the X handle charset.
 *  Returns "" for an empty/invalid arg (handlers turn that into a usage hint). */
function normalizeHandle(arg: string): string {
  const h = arg.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{1,30}$/.test(h) ? h : "";
}

const symDeps = (getSymbol?: GroupDeps["getSymbol"]) => (getSymbol ? { getSymbol } : undefined);
/** Cache-only variant — resolve from the warm cache, never the network. */
const cacheDeps = (getSymbol?: GroupDeps["getSymbol"]) => ({
  ...(getSymbol ? { getSymbol } : {}),
  cacheOnly: true as const,
});

// ── Static copy (easy to tune) ────────────────────────────────────────────────
const HELP = [
  "🤖 <b>THESIS</b> — an autonomous AI committee that reviews token theses posted on X and trades them on Base. Authors earn <b>25%</b> of every winning close, paid on-chain.",
  "",
  "<b>Commands</b>",
  "/stats — committee track record",
  "/leaderboard — top-earning authors",
  "/author &lt;handle&gt; — an author's record",
  "/recent — recent closed trades",
  "/open — current positions",
  "/check &lt;ticker&gt; — was a token reviewed?",
  "/how — submit a thesis",
  "/links — official links",
  "/rules — community rules",
].join("\n");

const HOW = [
  "📝 <b>How to submit a thesis</b>",
  "Post your token thesis on X and tag <b>@thesis_agent</b>. The committee reviews every tagged post.",
  "If it passes review and the committee buys, you earn <b>25% of every winning close</b> — paid automatically once you've registered a payout wallet.",
].join("\n");

const LINKS = [
  "🔗 <b>Official THESIS links</b>",
  "• Site &amp; dashboard: thesisonbase.com",
  "• X (announcements): @thesisonbase",
  "• X (tag your thesis): @thesis_agent",
  "• Source: github.com/thesisAI1/thesis",
  "",
  "⚠️ We will <b>never</b> DM you first, never ask for your seed phrase, and never ask you to “verify” your wallet. Anyone doing so is a scam — block &amp; report.",
].join("\n");

const RULES = [
  "📜 <b>Community rules</b>",
  "• English only in main",
  "• No spam, no shilling random tokens, no DM solicitations",
  "• No NSFW, no politics, no FUD spam",
  "• One warning → mute → ban",
].join("\n");

export interface GroupDeps {
  store?: StoreReads;
  getSymbol?: (contract: string, chain: Chain) => Promise<string>;
}

/** The known public commands — the poller checks this BEFORE running the
 *  handler so an unknown command (or chatter) costs no store read / cooldown
 *  slot, and stays silent. Keep in sync with the switch in handleGroupCommand. */
export const GROUP_COMMANDS: ReadonlySet<string> = new Set([
  "/start", "/help", "/how", "/links", "/rules",
  "/stats", "/leaderboard", "/author", "/recent", "/open", "/check",
]);

export async function handleGroupCommand(text: string, deps?: GroupDeps): Promise<string | null> {
  const store = deps?.store ?? (getStore() as unknown as StoreReads);
  const getSymbol = deps?.getSymbol;
  const { cmd, arg } = parseCommand(text);

  switch (cmd) {
    case "/start":
    case "/help":
      return HELP;
    case "/how":
      return HOW;
    case "/links":
      return LINKS;
    case "/rules":
      return RULES;
    case "/stats":
      return stats(store);
    case "/leaderboard":
      return leaderboard(store);
    case "/author":
      return author(store, arg);
    case "/recent":
      return recent(store, getSymbol);
    case "/open":
      return open(store, getSymbol);
    case "/check":
      return check(store, arg, getSymbol);
    default:
      return null; // unknown command / chatter → silent
  }
}

// ── Dynamic commands ──────────────────────────────────────────────────────────

async function stats(store: StoreReads): Promise<string> {
  const [funnel, all, reviews] = await Promise.all([
    store.getFunnel(),
    store.getAllPositions(),
    store.getReviews(),
  ]);
  const closed = all.filter((p) => p.status === "closed");
  const wins = closed.filter((p) => p.realisedPnlEth > 0).length;
  const losses = closed.filter((p) => p.realisedPnlEth < 0).length;
  const decided = wins + losses;
  const winRate = decided > 0 ? Math.round((wins / decided) * 100) : 0;
  const byChain = new Map<Chain, number>();
  for (const p of all) byChain.set(p.order.chain, (byChain.get(p.order.chain) ?? 0) + p.realisedPnlEth);
  return [
    "📊 <b>THESIS committee</b>",
    `Reviewed: ${reviews.length} · Bought: ${all.length}`,
    `Closed: ${closed.length} (${wins}W / ${losses}L · ${winRate}% win rate)`,
    `Realized PnL: ${fmtByChain(byChain)}`,
  ].join("\n");
}

async function leaderboard(store: StoreReads): Promise<string> {
  const [all, dists] = await Promise.all([store.getAllPositions(), store.getDistributions()]);
  const posById = new Map(all.map((p) => [p.id, p]));

  // Earnings per author, broken down per chain.
  const earned = new Map<string, Map<Chain, number>>();
  for (const d of dists) {
    const p = posById.get(d.positionId);
    if (!p) continue;
    const m = earned.get(p.authorHandle) ?? new Map<Chain, number>();
    m.set(p.order.chain, (m.get(p.order.chain) ?? 0) + d.toAuthorEth);
    earned.set(p.authorHandle, m);
  }
  // Rank by numeric total. NOTE: a rough cross-chain sort (no price oracle) —
  // single-chain today, revisit ranking when SOL volume is material.
  const earnRows = [...earned.entries()]
    .map(([h, m]) => ({ h, m, total: [...m.values()].reduce((a, b) => a + b, 0) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, LEADER_TOP);

  // Hit-rate per author over closed positions.
  const byAuthor = new Map<string, { w: number; l: number }>();
  for (const p of all.filter((x) => x.status === "closed")) {
    const rec = byAuthor.get(p.authorHandle) ?? { w: 0, l: 0 };
    if (p.realisedPnlEth > 0) rec.w++;
    else if (p.realisedPnlEth < 0) rec.l++;
    byAuthor.set(p.authorHandle, rec);
  }
  const hitRows = [...byAuthor.entries()]
    .map(([h, { w, l }]) => ({ h, w, l, n: w + l, rate: w + l > 0 ? w / (w + l) : 0 }))
    .filter((r) => r.n >= HITRATE_MIN_SAMPLE)
    .sort((a, b) => b.rate - a.rate || b.n - a.n)
    .slice(0, LEADER_TOP);

  const lines = ["🏆 <b>Leaderboard</b>", "", "<b>Top earners</b>"];
  if (earnRows.length === 0) lines.push("— no author payouts yet");
  earnRows.forEach((r, i) => {
    lines.push(`${i + 1}. ${esc(r.h)} — ${fmtByChain(r.m)}`);
  });
  lines.push("", `<b>Best hit-rate</b> (min ${HITRATE_MIN_SAMPLE} closes)`);
  if (hitRows.length === 0) lines.push("— not enough closes yet");
  hitRows.forEach((r, i) => lines.push(`${i + 1}. ${esc(r.h)} — ${Math.round(r.rate * 100)}% (${r.w}W/${r.l}L)`));
  return lines.join("\n");
}

async function author(store: StoreReads, arg: string): Promise<string> {
  const handle = normalizeHandle(arg);
  if (!handle) return "Usage: /author &lt;handle&gt; — e.g. /author @alice";

  const [all, dists] = await Promise.all([store.getAllPositions(), store.getDistributions()]);
  const mine = all.filter((p) => p.authorHandle.toLowerCase().replace(/^@/, "") === handle);
  if (mine.length === 0) {
    return `No record for @${esc(handle)} yet — tag @thesis_agent on X with a thesis to get reviewed.`;
  }
  const closed = mine.filter((p) => p.status === "closed");
  const w = closed.filter((p) => p.realisedPnlEth > 0).length;
  const l = closed.filter((p) => p.realisedPnlEth < 0).length;
  const openCount = mine.filter((p) => p.status === "open").length;

  const chainOf = new Map(mine.map((p) => [p.id, p.order.chain]));
  const myIds = new Set(mine.map((p) => p.id));
  const earnedByChain = new Map<Chain, number>();
  for (const d of dists) {
    if (!myIds.has(d.positionId)) continue;
    const ch = chainOf.get(d.positionId) ?? "base";
    earnedByChain.set(ch, (earnedByChain.get(ch) ?? 0) + d.toAuthorEth);
  }
  return [
    `👤 <b>${esc(mine[0]!.authorHandle)}</b>`,
    `Calls: ${mine.length} · Closed ${closed.length} (${w}W/${l}L) · Open ${openCount}`,
    `Earned: ${fmtByChain(earnedByChain)}`,
  ].join("\n");
}

async function recent(store: StoreReads, getSymbol?: GroupDeps["getSymbol"]): Promise<string> {
  const all = await store.getAllPositions();
  const closed = all
    .filter((p) => p.status === "closed" && p.closedAt)
    .sort((a, b) => (a.closedAt! < b.closedAt! ? 1 : -1))
    .slice(0, RECENT_LIMIT);
  if (closed.length === 0) return "No closed trades yet.";

  const lines = ["📕 <b>Recent closes</b>"];
  for (const p of closed) {
    const sym = await resolveSymbol(p.order.contractAddress, p.order.chain, symDeps(getSymbol));
    const ticker = sym ? `$${esc(sym)}` : "token";
    const emoji = p.realisedPnlEth > 0 ? "🟢" : p.realisedPnlEth < 0 ? "🔴" : "⚪";
    const pct = pnlPct(p.realisedPnlEth, p.order.amountInEth);
    const sign = pct > 0 ? "+" : "";
    lines.push(`${emoji} ${ticker} ${esc(p.authorHandle)} ${sign}${pct}% (${p.realisedPnlEth.toFixed(4)} ${nativeSymbol(p.order.chain)})`);
  }
  return lines.join("\n");
}

async function open(store: StoreReads, getSymbol?: GroupDeps["getSymbol"]): Promise<string> {
  const allOpen = (await store.getOpenPositions()).sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1));
  if (allOpen.length === 0) return "No open positions right now.";
  const openPos = allOpen.slice(0, OPEN_LIMIT);

  // Header shows the TRUE total; note when the list is truncated for length.
  const header =
    allOpen.length > openPos.length
      ? `🟢 <b>Open positions</b> (${allOpen.length}, showing ${openPos.length})`
      : `🟢 <b>Open positions</b> (${allOpen.length})`;
  const lines = [header];
  for (const p of openPos) {
    const sym = await resolveSymbol(p.order.contractAddress, p.order.chain, symDeps(getSymbol));
    const label = sym ? `$${esc(sym)}` : "token";
    const url = chartUrl(p.order.chain, p.order.contractAddress);
    lines.push(`• <a href="${escAttr(url)}">${label}</a> ${esc(p.authorHandle)}`);
  }
  return lines.join("\n");
}

async function check(store: StoreReads, arg: string, getSymbol?: GroupDeps["getSymbol"]): Promise<string> {
  const q = arg.trim();
  if (!q) return "Usage: /check &lt;ticker&gt; — e.g. /check WIF";

  const reviews = await store.getReviews();
  const isAddr = /^0x[0-9a-fA-F]{6,}$/.test(q) || /^[1-9A-HJ-NP-Za-km-z]{32,}$/.test(q);
  let match: ReviewRecord | undefined;
  let matchSym = "";

  if (isAddr) {
    match = [...reviews].reverse().find((r) => r.contractAddress.toLowerCase() === q.toLowerCase());
    if (match) matchSym = await resolveSymbol(match.contractAddress, match.chain, cacheDeps(getSymbol));
  } else {
    // Ticker path is CACHE-ONLY: never hit the network adapter (it is shared
    // with the live trading loop — a public /check must not be able to fan a
    // single message into dozens of upstream symbol lookups). Only tokens the
    // bot has already tracked (notifier / other commands) resolve here.
    const ticker = q.replace(/^\$/, "").toLowerCase();
    for (const r of [...reviews].reverse()) {
      const sym = await resolveSymbol(r.contractAddress, r.chain, cacheDeps(getSymbol));
      if (sym && sym.toLowerCase() === ticker) {
        match = r;
        matchSym = sym;
        break;
      }
    }
  }

  if (!match) {
    return `No tracked review for ${esc(q)} — it may not have been submitted (or isn't in recent activity). Tag @thesis_agent on X to get it reviewed.`;
  }
  const decision = String(match.decision).toUpperCase();
  const verdict = decision === "BUY" ? "✅ BUY (bought)" : "⏭️ SKIP";
  const ticker = matchSym ? `$${esc(matchSym)}` : "token";
  return [
    `🔎 <b>${ticker}</b> by ${esc(match.authorHandle)}`,
    `Verdict: ${verdict} · Grade ${esc(String(match.grade))}`,
    `Scores: author ${match.authorScore}/100 · token ${match.tokenScore}/100`,
  ].join("\n");
}
