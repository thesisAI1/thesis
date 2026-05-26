/**
 * The TP / SL monitor.
 *
 * Watches every open position. As the price crosses each take-profit tier it
 * sells that slice AT the tier's level (a take-profit is a limit exit). The
 * ladder is TP1..TP4; once TP4 fires the position is fully sold.
 *
 * The stop-loss TRAILS: it sits `stopLossPct`% below the highest milestone the
 * position has reached — entry before any tier, then each TP tier's level as
 * it is hit. So a token that hits a tier and then fades is sold near that
 * tier, locking in profit, and the position always closes.
 *
 * Profit accrues across the tiers; the 25/25/25/25 split runs ONCE, when the
 * position fully closes (TP4 reached, or stopped out) and only if it is in
 * net profit. Each exit is announced as a reply on the original X post.
 */

import type { Position } from "@thesis/shared";
import { createChainAdapter } from "../adapters/chain/index.js";
import { createXAdapter } from "../adapters/x/index.js";
import { publish } from "../events.js";
import { settlePosition } from "../pipeline/index.js";
import { getStore } from "../store/index.js";
import { log } from "../util/log.js";
import { exitReplyText } from "../util/replies.js";

/** Check every open position once; act on take-profit tiers and the stop-loss. */
export async function runMonitorTick(): Promise<void> {
  const store = getStore();
  const chain = createChainAdapter();
  const open = await store.getOpenPositions();

  for (const pos of open) {
    let price: number;
    try {
      price = await chain.getTokenPriceEth(pos.order.contractAddress);
    } catch (err) {
      log.warn(`monitor: price check failed for ${pos.id}: ${String(err)}`);
      continue;
    }
    await processPosition(pos, price);
  }
}

/** The current stop-loss price — trails the highest milestone reached. */
function stopPrice(pos: Position): number {
  const milestoneX =
    pos.tiersHit === 0 ? 1 : pos.order.takeProfits[pos.tiersHit - 1].priceX;
  return pos.entryPriceEth * milestoneX * pos.order.stopLossX;
}

async function processPosition(pos: Position, price: number): Promise<void> {
  // Trailing stop-loss takes priority — sell the whole remainder and close.
  if (price <= stopPrice(pos)) {
    await stopOut(pos);
    return;
  }
  // Fire every take-profit tier the price has already reached.
  let fired = false;
  while (
    pos.tiersHit < pos.order.takeProfits.length &&
    price >= pos.entryPriceEth * pos.order.takeProfits[pos.tiersHit].priceX
  ) {
    await takeTier(pos);
    fired = true;
  }
  if (!fired) return;

  if (pos.tiersHit >= pos.order.takeProfits.length) {
    // Every tier cleared — the position is fully sold.
    pos.status = "closed";
    pos.closedAt = new Date().toISOString();
    await getStore().savePosition(pos);
    log.info(`monitor: ${pos.id} fully closed — all take-profit tiers cleared`);
    await settle(pos);
  } else {
    await getStore().savePosition(pos);
  }
}

/** Fire the next take-profit tier: sell its slice AT the tier level. */
async function takeTier(pos: Position): Promise<void> {
  const tier = pos.order.takeProfits[pos.tiersHit];
  const tierNum = pos.tiersHit + 1;
  const gainPct = Math.round((tier.priceX - 1) * 100);
  const exitPrice = pos.entryPriceEth * tier.priceX;
  const cost = pos.order.amountInEth * tier.sellFraction;

  const sale = await sell(pos, cost, exitPrice);

  pos.tiersHit += 1;
  pos.remainingFraction = Math.max(0, pos.remainingFraction - tier.sellFraction);
  pos.realisedPnlEth += sale.profit;
  pos.lastExitPriceEth = exitPrice;
  pos.lastExitTxHash = sale.txHash;
  const final = pos.tiersHit >= pos.order.takeProfits.length;

  log.info(
    `monitor: ${pos.id} TP${tierNum} hit (+${gainPct}%) — sold ` +
      `${Math.round(tier.sellFraction * 100)}%, ${sale.proceeds.toFixed(4)} ETH back ` +
      `(+${sale.profit.toFixed(4)} profit)`,
  );
  await reply(pos, {
    kind: "tp",
    tier: tierNum,
    gainPct,
    sellPct: Math.round(tier.sellFraction * 100),
    proceedsEth: sale.proceeds,
    profitEth: sale.profit,
    final,
    txHash: sale.txHash,
  });
}

/** Stop-loss: sell the whole remaining position, close, and settle. */
async function stopOut(pos: Position): Promise<void> {
  const exitPrice = stopPrice(pos);
  const cost = pos.order.amountInEth * pos.remainingFraction;
  const sale = await sell(pos, cost, exitPrice);

  pos.realisedPnlEth += sale.profit;
  pos.remainingFraction = 0;
  pos.status = "closed";
  pos.lastExitPriceEth = exitPrice;
  pos.lastExitTxHash = sale.txHash;
  pos.closedAt = new Date().toISOString();
  await getStore().savePosition(pos);

  const total = pos.realisedPnlEth;
  log.info(
    `monitor: ${pos.id} stopped out — net result ${total >= 0 ? "+" : ""}${total.toFixed(4)} ETH`,
  );
  await settle(pos); // split only if the trade is net positive overall
  await reply(pos, { kind: "sl", netPnlEth: total, tiersHit: pos.tiersHit, txHash: sale.txHash });
}

/** Split the position's total realised profit 25/25/25/25 (once, at close). */
async function settle(pos: Position): Promise<void> {
  if (pos.realisedPnlEth <= 0) return;
  const dist = await settlePosition(pos, pos.realisedPnlEth);
  if (!dist) return;
  await getStore().saveDistribution(dist);
  publish({
    type: "endowment",
    positionId: dist.positionId,
    authorHandle: pos.authorHandle,
    totalProfitEth: dist.totalProfitEth,
    toAuthorEth: dist.toAuthorEth,
    toBuybackEth: dist.toBuybackEth,
    authorWallet: dist.authorWallet,
  });
}

/**
 * Sell a slice of the position worth `costEth` of the original buy, realised
 * AT `exitPrice` (the tier or stop-loss level). The on-chain swap still
 * executes; its tx hash is recorded.
 */
async function sell(
  pos: Position,
  costEth: number,
  exitPrice: number,
): Promise<{ proceeds: number; profit: number; txHash: string }> {
  const originalTokens =
    pos.entryPriceEth > 0 ? pos.order.amountInEth / pos.entryPriceEth : 0;
  const tokens =
    pos.order.amountInEth > 0 ? originalTokens * (costEth / pos.order.amountInEth) : 0;

  let txHash = "";
  try {
    txHash = (await createChainAdapter().sell(pos.order.contractAddress, tokens)).txHash;
  } catch (err) {
    log.warn(`monitor: sell failed for ${pos.id}: ${String(err)}`);
  }
  const proceeds = tokens * exitPrice;
  return { proceeds, profit: proceeds - costEth, txHash };
}

/** Announce an exit on the original X post. */
async function reply(
  pos: Position,
  o:
    | {
        kind: "tp";
        tier: number;
        gainPct: number;
        sellPct: number;
        proceedsEth: number;
        profitEth: number;
        final: boolean;
        txHash: string;
      }
    | { kind: "sl"; netPnlEth: number; tiersHit: number; txHash: string },
): Promise<void> {
  try {
    const replyId = await createXAdapter().replyToPost(pos.postId, exitReplyText(o));
    log.info(`x: replied to ${pos.postId} (${o.kind}) — reply ${replyId}`);
  } catch (err) {
    log.warn(`x: exit reply failed for ${pos.postId}: ${String(err)}`);
  }
}
