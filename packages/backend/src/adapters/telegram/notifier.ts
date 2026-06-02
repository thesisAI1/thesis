import { config } from "../../config.js";
import { subscribeOps, type OpsEvent } from "../../observability/opsBus.js";
import {
  explorerAddrUrl,
  explorerTokenUrl,
  explorerTxUrl,
  nativeGlyph,
} from "../../util/chains.js";
import { createTelegramAdapter, type TelegramAdapter } from "./index.js";
import { redactText, truncAddr } from "./redact.js";

// ── HTML helpers ─────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape a string for use inside an HTML attribute value (href="…"). */
function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function aLink(url: string, label: string): string {
  return `<a href="${escAttr(url)}">${esc(label)}</a>`;
}

function xStatusUrl(id: string): string {
  return `https://x.com/i/web/status/${id}`;
}

// ── Formatter ────────────────────────────────────────────────────────────────

/**
 * Format an OpsEvent as an HTML Telegram message for the ADMIN bot.
 *
 * SAFETY RULES:
 * - Full address/hash may only appear inside an href (admin channel is private).
 * - Every plain-text display of an address/hash uses truncAddr().
 * - Free-text fields (error.msg, settle:failed.reason, payout:failed.reason)
 *   are passed through redactText() then esc() — in that order.
 * - User-controlled display values (handle, area, kind) are esc()-only.
 * - Do NOT blanket-redactText() the full HTML line (would scrub hrefs).
 * - Do NOT esc() the href URL itself (controlled domain + hex/id).
 */
export function formatOpsEvent(e: OpsEvent): string | null {
  switch (e.type) {
    case "trade:buy":
      return (
        `🟢 BUY ${esc(e.handle)} ${e.amountEth}${nativeGlyph(e.chain)} ` +
        `(${aLink(explorerTokenUrl(e.chain, e.contract), truncAddr(e.contract))})`
      );

    case "trade:sell":
      return (
        `🔻 SELL pos=${e.positionId} tier=${e.tier} ` +
        `proceeds=${e.proceedsEth}${nativeGlyph(e.chain)} ` +
        `profit=${e.profitEth}${nativeGlyph(e.chain)}`
      );

    case "position:close":
      return (
        `🏁 position:close pos=${e.positionId} ` +
        `pnl=${e.netPnlEth}${nativeGlyph(e.chain)} reason=${e.reason}`
      );

    case "payout:sent": {
      const walletLink = aLink(explorerAddrUrl(e.chain, e.wallet), truncAddr(e.wallet));
      const txLink = aLink(explorerTxUrl(e.chain, e.txHash), "tx " + truncAddr(e.txHash));
      return `💸 PAID ${esc(e.handle)} ${e.amountEth}${nativeGlyph(e.chain)} → ${walletLink} (${txLink})`;
    }

    case "payout:failed":
      return `🔴 PAYOUT FAILED ${esc(e.handle)} ${e.amountEth}${nativeGlyph(e.chain)}: ${esc(redactText(e.reason))}`;

    case "settle:done":
      return (
        `📊 settle:done pos=${e.positionId} ` +
        `toAuthor=${e.toAuthorEth}${nativeGlyph(e.chain)} total=${e.totalProfitEth}${nativeGlyph(e.chain)}`
      );

    case "settle:summary":
      return null;

    case "settle:failed":
      return `⚠️ settle:failed pos=${e.positionId}: ${esc(redactText(e.reason))}`;

    case "tweet:posted":
      return (
        `🐦 tweet:posted kind=${esc(e.kind)} ` +
        `${aLink(xStatusUrl(e.replyId), "reply")} ` +
        `${aLink(xStatusUrl(e.postId), "post")}`
      );

    case "error":
      return `🔴 [${esc(e.area)}] ${esc(redactText(e.msg))}`;

    case "liveness:stale":
      return `⚠️ liveness: no poll tick for ${e.secondsSinceTick}s`;

    default:
      return null;
  }
}

export function startNotifier(deps?: {
  adapter?: TelegramAdapter;
  allowedChats?: string[];
  enabled?: boolean;
}): () => void {
  const enabled = deps?.enabled ?? config.telegram.enabled;
  const allowedChats = deps?.allowedChats ?? config.telegram.allowedChats;

  if (!enabled || allowedChats.length === 0) {
    return () => {};
  }

  const adapter = deps?.adapter ?? createTelegramAdapter();

  const unsubscribe = subscribeOps((e) => {
    const t = formatOpsEvent(e);
    if (!t) return;
    for (const c of allowedChats) {
      void adapter.sendMessage(c, t, { parseMode: "HTML" }).catch(() => {});
    }
  });

  return unsubscribe;
}
