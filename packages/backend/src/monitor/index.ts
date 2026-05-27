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
import { createBaseDataAdapter } from "../adapters/basedata/index.js";
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
  const open = await store.getOpenPositions();
  if (open.length === 0) return;

  // Pull prices for ALL open positions in a single batched API call. This is
  // what keeps us under the data-provider rate limit when N positions are
  // open. With Birdeye's /defi/multi_price one tick = one HTTP request.
  const addresses = Array.from(
    new Set(open.map((p) => p.order.contractAddress.toLowerCase())),
  );
  let prices: Map<string, number>;
  try {
    prices = await createBaseDataAdapter().getPricesEth(addresses);
  } catch (err) {
    log.warn(`monitor: batch price fetch failed — skipping tick: ${String(err)}`);
    return;
  }

  for (const pos of open) {
    const price = prices.get(pos.order.contractAddress.toLowerCase());
    if (price === undefined || price <= 0) {
      log.warn(`monitor: no live price for ${pos.id} — will retry next tick`);
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
    const ok = await takeTier(pos);
    if (!ok) return; // sell reverted — leave state untouched, retry next tick
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
async function takeTier(pos: Position): Promise<boolean> {
  const tier = pos.order.takeProfits[pos.tiersHit];
  const tierNum = pos.tiersHit + 1;
  const gainPct = Math.round((tier.priceX - 1) * 100);
  const exitPrice = pos.entryPriceEth * tier.priceX;
  const cost = pos.order.amountInEth * tier.sellFraction;

  let sale: { proceeds: number; profit: number; txHash: string };
  try {
    sale = await sell(pos, cost, exitPrice);
  } catch (err) {
    // The on-chain swap reverted (e.g. TransferHelper: TRANSFER_FROM_FAILED).
    // Do NOT advance the tier counter or credit any PnL — next monitor tick
    // will retry, by which time the underlying issue may have cleared (balance
    // settled, anti-MEV cooldown elapsed, slippage room opened up, etc.).
    log.warn(`monitor: ${pos.id} TP${tierNum} sell reverted — will retry next tick: ${String(err)}`);
    return false;
  }

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
  return true;
}

/** Stop-loss: sell the whole remaining position, close, and settle. */
async function stopOut(pos: Position): Promise<void> {
  const exitPrice = stopPrice(pos);
  const cost = pos.order.amountInEth * pos.remainingFraction;

  let sale: { proceeds: number; profit: number; txHash: string };
  try {
    sale = await sell(pos, cost, exitPrice);
  } catch (err) {
    // Same deal as takeTier — do NOT mark the position closed, do NOT credit
    // any PnL, do NOT settle. Retry on the next monitor tick.
    log.warn(`monitor: ${pos.id} stop-out sell reverted — will retry next tick: ${String(err)}`);
    return;
  }

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
 * Sell a slice of the position worth `costEth` of the original buy. The
 * on-chain swap actually executes; we credit the ETH we ACTUALLY received
 * (`result.amountOut`) as proceeds — not the theoretical tier price.
 *
 * This used to compute `proceeds = tokens × exitPrice`, which assumed the
 * sell filled at the trigger price. When the price provider briefly spiked
 * above the tier threshold (causing the monitor to fire) but the actual
 * KyberSwap fill came in at a lower price, the system recorded profit that
 * was never realised on-chain. Now proceeds come straight from the swap
 * output, so the recorded PnL matches what the wallet actually received.
 *
 * THROWS when the on-chain swap reverts. Callers MUST treat a thrown sell as
 * "nothing happened" — do NOT advance tier counters, do NOT credit realised
 * PnL, do NOT post a reply, do NOT settle. The next monitor tick will retry.
 */
async function sell(
  pos: Position,
  costEth: number,
  _exitPrice: number,
): Promise<{ proceeds: number; profit: number; txHash: string }> {
  const originalTokens =
    pos.entryPriceEth > 0 ? pos.order.amountInEth / pos.entryPriceEth : 0;
  const tokens =
    pos.order.amountInEth > 0 ? originalTokens * (costEth / pos.order.amountInEth) : 0;

  const result = await createChainAdapter().sell(pos.order.contractAddress, tokens);
  // result.amountOut is the ETH the wallet actually received from KyberSwap.
  // exitPrice is kept in the signature only so the call sites stay
  // self-documenting (which tier triggered us); we no longer multiply by it.
  const proceeds = result.amountOut;
  return { proceeds, profit: proceeds - costEth, txHash: result.txHash };
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
