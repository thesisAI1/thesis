import { config } from "../../config.js";
import { getEventLog } from "../../observability/eventLog.js";
import { getStore } from "../../store/index.js";
import type { Distribution, Position, ReviewRecord } from "@thesis/shared";
import type { Funnel } from "../../store/index.js";
import { truncAddr, redactText } from "./redact.js";

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

  const cmd = text.trim().split(/\s+/)[0] ?? "";

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
          `${p.id} ${truncAddr(p.order.contractAddress)} ${p.authorHandle} pnl ${p.realisedPnlEth.toFixed(4)}Ξ`,
      );
      return lines.join("\n");
    }

    case "/pnl": {
      const all = await store.getAllPositions();
      const dists = await store.getDistributions();
      const realized = all.reduce((sum, p) => sum + p.realisedPnlEth, 0);
      const toAuthors = dists.reduce((sum, d) => sum + d.toAuthorEth, 0);
      return `realized PnL ${realized.toFixed(4)}Ξ · total to authors ${toAuthors.toFixed(4)}Ξ`;
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
