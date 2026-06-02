import { config } from "../../config.js";
import { getEventLog } from "../../observability/eventLog.js";
import { getStore } from "../../store/index.js";
import type { Chain, Distribution, Position, ReviewRecord } from "@thesis/shared";
import { nativeSymbol } from "@thesis/shared";
import type { Funnel } from "../../store/index.js";
import { truncAddr, redactText } from "./redact.js";
import { parseCommand } from "./parse.js";

/** Sum a Map<Chain, number> into "0.1234 ETH + 0.5 SOL" (per-chain, never the Ξ
 *  glyph and never summing across chains). Empty → "0 ETH". */
function fmtByChain(byChain: Map<Chain, number>): string {
  const parts = [...byChain.entries()]
    .filter(([, v]) => v !== 0)
    .map(([chain, v]) => `${v.toFixed(4)} ${nativeSymbol(chain)}`);
  return parts.length > 0 ? parts.join(" + ") : "0 ETH";
}

export interface StoreReads {
  getOpenPositions(): Promise<Position[]>;
  getAllPositions(): Promise<Position[]>;
  getDistributions(): Promise<Distribution[]>;
  getFunnel(): Promise<Funnel>;
  getReviews(): Promise<ReviewRecord[]>;
}

export async function handleCommand(
  text: string,
  chatId: string,
  deps?: { allowedChats?: string[]; store?: StoreReads },
): Promise<string | null> {
  const allowedChats = deps?.allowedChats ?? config.telegram.allowedChats;
  const store = deps?.store ?? (getStore() as unknown as StoreReads);

  if (!allowedChats.includes(chatId)) return null;

  const { cmd } = parseCommand(text);

  switch (cmd) {
    case "/help":
      return "/help /status /positions /pnl /stats /recent";

    case "/status": {
      const open = await store.getOpenPositions();
      const funnel = await store.getFunnel();
      return `open positions: ${open.length} · funnel seen=${funnel.seen} passed=${funnel.passed}`;
    }

    case "/positions": {
      const open = await store.getOpenPositions();
      if (open.length === 0) return "no open positions.";
      const lines = open.map(
        (p) =>
          `${p.id} ${truncAddr(p.order.contractAddress)} ${p.authorHandle} pnl ${p.realisedPnlEth.toFixed(4)} ${nativeSymbol(p.order.chain)}`,
      );
      return lines.join("\n");
    }

    case "/pnl": {
      const all = await store.getAllPositions();
      const dists = await store.getDistributions();
      // Group per chain — ETH and SOL are different currencies and must never
      // be summed into one number. Distribution carries no chain, so join it to
      // its position via positionId (fall back to base for an orphan dist).
      const chainOf = new Map<string, Chain>(all.map((p) => [p.id, p.order.chain]));
      const realizedByChain = new Map<Chain, number>();
      for (const p of all) {
        realizedByChain.set(p.order.chain, (realizedByChain.get(p.order.chain) ?? 0) + p.realisedPnlEth);
      }
      const authorByChain = new Map<Chain, number>();
      for (const d of dists) {
        const ch = chainOf.get(d.positionId) ?? "base";
        authorByChain.set(ch, (authorByChain.get(ch) ?? 0) + d.toAuthorEth);
      }
      return `realized PnL ${fmtByChain(realizedByChain)} · total to authors ${fmtByChain(authorByChain)}`;
    }

    case "/stats": {
      const funnel = await store.getFunnel();
      const reviews = await store.getReviews();
      const all = await store.getAllPositions();
      const buys = all.length;
      return `funnel seen=${funnel.seen} passed=${funnel.passed} · reviews=${reviews.length} · buys=${buys}`;
    }

    case "/recent": {
      const entries = getEventLog().recent(10);
      if (entries.length === 0) return "no recent events.";
      return entries
        .map((e) => redactText(`[${e.level}] [${e.area}] ${e.msg}`))
        .join("\n");
    }

    default:
      return "unknown command. try /help";
  }
}
