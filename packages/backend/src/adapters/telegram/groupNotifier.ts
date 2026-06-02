/**
 * Wave 5 — public group message formatter.
 *
 * Turns an OpsEvent into a { text, gif } group announcement, or null if the
 * group should NOT announce that event.  Pure logic: no Telegram API calls.
 */

import type { OpsEvent } from "../../observability/opsBus.js";
import { subscribeOps } from "../../observability/opsBus.js";
import { enrichPosition, pnlPct, type PositionEnrichment } from "./enrich.js";
import { nativeSymbol } from "@thesis/shared";
import type { GroupGifKind } from "./assets.js";
import { resolveAsset as assetsResolveAsset, rememberFileId } from "./assets.js";
import { redactText } from "./redact.js";
import { config } from "../../config.js";
import { createTelegramAdapter, type TelegramAdapter } from "./index.js";
import { log } from "../../util/log.js";

// ── Public types ──────────────────────────────────────────────────────────────

export interface GroupMessage {
  text: string;
  gif: GroupGifKind | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function trimEth(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // toFixed(4) then strip trailing zeros after decimal
  return parseFloat(n.toFixed(4)).toString();
}

function symbolOrFallback(enr: PositionEnrichment & { found: true }): string {
  return enr.symbol || "a new token";
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case "sl": return "stop-loss";
    case "aging": return "aged out";
    default: return "closed";
  }
}

// ── Main formatter ────────────────────────────────────────────────────────────

export async function formatGroupEvent(
  e: OpsEvent,
  deps?: { enrich?: (positionId: string) => Promise<PositionEnrichment> },
): Promise<GroupMessage | null> {
  const enrich = deps?.enrich ?? ((id: string) => enrichPosition(id));

  switch (e.type) {
    case "trade:buy": {
      const enr = await enrich(e.positionId);
      if (!enr.found) return null;
      const sym = symbolOrFallback(enr);
      const text = redactText(
        `🚀 New call: $${sym} by ${e.handle}\n` +
        `Entry: ${trimEth(e.amountEth)} ${enr.unit}`,
      );
      return { text, gif: "buy" };
    }

    case "trade:sell": {
      const enr = await enrich(e.positionId);
      if (!enr.found) return null;
      const sym = symbolOrFallback(enr);
      const gainPct = pnlPct(e.profitEth, e.proceedsEth - e.profitEth);
      const authorSuffix = enr.authorHandle ? ` · called by ${enr.authorHandle}` : "";
      const text = redactText(
        `💰 TP${e.tier} hit · +${gainPct}%: $${sym}\n` +
        `Locked ${trimEth(e.profitEth)} ${enr.unit} profit (still running)${authorSuffix}`,
      );
      return { text, gif: "tp" };
    }

    case "settle:summary": {
      const enr = await enrich(e.positionId);
      if (!enr.found) return null;
      const sym = symbolOrFallback(enr);
      const pct = pnlPct(e.totalProfitEth, enr.entryEth);
      const sign = pct >= 0 ? "+" : "";
      const authorLine =
        e.authorPaid === "escrowed"
          ? `${e.handle}: ${trimEth(e.toAuthorEth)} ${enr.unit} reserved — awaiting wallet`
          : `${e.handle}: ${trimEth(e.toAuthorEth)} ${enr.unit}`;
      const text = redactText(
        `🏆 $${sym} closed ${sign}${pct}% — ${trimEth(e.totalProfitEth)} ${enr.unit} profit\n\n` +
        `Split:\n` +
        `${authorLine}\n` +
        `Portfolio: ${trimEth(e.toPortfolioEth)} ${enr.unit}\n` +
        `Holders/team: ${trimEth(e.toTeamEth)} ${enr.unit}\n` +
        `Buyback&burn: ${trimEth(e.toBuybackEth)} ${enr.unit}`,
      );
      return { text, gif: "close-split" };
    }

    case "position:close": {
      // Break-even (netPnlEth === 0) is intentionally NOT announced — neither a win nor a loss.
      if (e.netPnlEth > 0) return null;
      const enr = await enrich(e.positionId);
      if (!enr.found) return null;
      const sym = symbolOrFallback(enr);
      const pct = pnlPct(e.netPnlEth, enr.entryEth);
      const reason = reasonLabel(e.reason);
      const text = redactText(
        `📉 $${sym} closed ${pct}% (${reason})`,
      );
      return { text, gif: null };
    }

    case "payout:sent": {
      if (e.path !== "escrow") return null;
      const unit = nativeSymbol(e.chain);
      const text = redactText(
        `✅ ${e.handle} claimed their ${trimEth(e.amountEth)} ${unit} author cut`,
      );
      return { text, gif: "author-claim" };
    }

    default:
      return null;
  }
}

// ── Group notifier ────────────────────────────────────────────────────────────

export function startGroupNotifier(deps?: {
  adapter?: TelegramAdapter;
  enabled?: boolean;
  chatId?: string;
  botToken?: string;
  format?: (e: OpsEvent) => Promise<GroupMessage | null>;
  resolveAsset?: (kind: GroupGifKind) => { fileId: string } | { path: string } | null;
}): () => void {
  const enabled = deps?.enabled ?? config.telegram.group.enabled;
  const chatId = deps?.chatId ?? config.telegram.group.chatId;
  const botToken = deps?.botToken ?? config.telegram.group.botToken;

  if (!enabled || !chatId || !botToken) {
    return () => {};
  }

  const adapter = deps?.adapter ?? createTelegramAdapter({ botToken });
  const format = deps?.format ?? ((e: OpsEvent) => formatGroupEvent(e));
  const resolve = deps?.resolveAsset ?? assetsResolveAsset;

  const unsubscribe = subscribeOps((e) => {
    void format(e).then(async (msg) => {
      if (!msg) return;
      const asset = msg.gif ? resolve(msg.gif) : null;
      if (asset) {
        const r = await adapter.sendAnimation(chatId, asset, msg.text);
        if (r.ok && r.fileId && msg.gif && !("fileId" in asset)) {
          rememberFileId(msg.gif, r.fileId);
        }
      } else {
        await adapter.sendMessage(chatId, msg.text);
      }
    }).catch((err) => log.warn(redactText(`groupNotifier: send failed: ${String(err)}`)));
  });

  return unsubscribe;
}
