/**
 * THE BURSAR — executes the trade.
 *
 * Turns a BUY verdict into a position: enforces the anti-spam rate limit,
 * sizes the trade (5-10% of the portfolio), buys on Base, attaches take-profit
 * / stop-loss levels, and persists the open position.
 */

import type { Position, TradeOrder, Verdict } from "@thesis/shared";
import { config } from "../config.js";
import { createChainAdapter } from "../adapters/chain/index.js";
import { getStore } from "../store/index.js";

export interface BursarResult {
  position: Position | null;
  /** Why no position was opened (rate limit, cooldown, empty portfolio...). */
  skippedReason?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function runBursar(verdict: Verdict): Promise<BursarResult> {
  if (verdict.decision !== "BUY") {
    return { position: null, skippedReason: "verdict is SKIP" };
  }

  const store = getStore();

  // --- Anti-spam rate limit ---------------------------------------------
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const buysToday = await store.countBuysSince(since);
  if (buysToday >= config.trading.maxBuysPerDay) {
    return {
      position: null,
      skippedReason: `daily buy limit reached (${config.trading.maxBuysPerDay})`,
    };
  }
  const last = await store.lastBuyAt();
  if (last) {
    const elapsedMin = (Date.now() - new Date(last).getTime()) / 60000;
    if (elapsedMin < config.trading.buyCooldownMinutes) {
      const left = Math.ceil(config.trading.buyCooldownMinutes - elapsedMin);
      return { position: null, skippedReason: `cooldown active (${left}m left)` };
    }
  }

  // --- Size and execute --------------------------------------------------
  const chain = createChainAdapter();
  const portfolioEth = await chain.getWalletBalanceEth();
  const amountInEth = portfolioEth * verdict.positionSizePct;
  if (amountInEth <= 0) {
    return { position: null, skippedReason: "trading portfolio is empty" };
  }

  const order: TradeOrder = {
    contractAddress: verdict.submission.contractAddress,
    chain: verdict.submission.chain,
    amountInEth,
    takeProfits: config.trading.takeProfitTiers.map((t) => ({
      priceX: 1 + t.gainPct / 100,
      sellFraction: t.sellPct / 100,
    })),
    stopLossX: 1 - config.trading.stopLossPct / 100,
  };

  const fill = await chain.buy(order.contractAddress, order.amountInEth);
  const now = new Date().toISOString();
  await store.recordBuy(now);

  const position: Position = {
    id: `pos-${verdict.submission.postId}`,
    postId: verdict.submission.postId,
    authorXId: verdict.submission.authorXId,
    authorHandle: verdict.submission.authorHandle,
    authorAvatarUrl: verdict.submission.authorAvatarUrl,
    postUrl: verdict.submission.postUrl,
    order,
    status: "open",
    entryPriceEth: fill.priceEth,
    entryTxHash: fill.txHash,
    // Snapshot the on-chain market cap at the moment the buy fills, so the
    // dashboard can show the entry-vs-now spread without a historical lookup.
    marketCapAtEntryUsd: verdict.tokenReport.marketCapUsd,
    remainingFraction: 1,
    tiersHit: 0,
    realisedPnlEth: 0,
    openedAt: now,
  };
  await store.savePosition(position);

  return { position };
}
