import { config } from "../../config.js";
import { subscribeOps, type OpsEvent } from "../../observability/opsBus.js";
import { createTelegramAdapter, type TelegramAdapter } from "./index.js";
import { truncAddr } from "./redact.js";

export function formatOpsEvent(e: OpsEvent): string | null {
  switch (e.type) {
    case "error":
      return `🔴 [${e.area}] ${e.msg}`;

    case "tweet:posted":
      return `🐦 tweet:posted kind=${e.kind} reply=${e.replyId} post=${e.postId}`;

    case "liveness:stale":
      return `⚠️ liveness: no poll tick for ${e.secondsSinceTick}s`;

    case "trade:buy":
      return `🟢 BUY ${e.handle} ${e.amountEth}Ξ (${truncAddr(e.contract)})`;

    case "trade:sell":
      return `🔻 SELL pos=${e.positionId} tier=${e.tier} proceeds=${e.proceedsEth}Ξ profit=${e.profitEth}Ξ`;

    case "position:close":
      return `🏁 position:close pos=${e.positionId} pnl=${e.netPnlEth}Ξ reason=${e.reason}`;

    case "payout:sent":
      return `💸 PAID ${e.handle} ${e.amountEth}Ξ → ${truncAddr(e.wallet)} (tx ${truncAddr(e.txHash)})`;

    case "payout:failed":
      return `🔴 PAYOUT FAILED ${e.handle} ${e.amountEth}Ξ: ${e.reason}`;

    case "settle:done":
      return `📊 settle:done pos=${e.positionId} toAuthor=${e.toAuthorEth}Ξ total=${e.totalProfitEth}Ξ`;

    case "settle:failed":
      return `⚠️ settle:failed pos=${e.positionId}: ${e.reason}`;

    default:
      return null;
  }
}

export function startNotifier(deps?: {
  adapter?: TelegramAdapter;
  allowedChats?: string[];
}): () => void {
  const adapter = deps?.adapter ?? createTelegramAdapter();
  const allowedChats = deps?.allowedChats ?? config.telegram.allowedChats;

  if (allowedChats.length === 0) {
    return () => {};
  }

  const unsubscribe = subscribeOps((e) => {
    const t = formatOpsEvent(e);
    if (!t) return;
    for (const c of allowedChats) {
      void adapter.sendMessage(c, t);
    }
  });

  return unsubscribe;
}
