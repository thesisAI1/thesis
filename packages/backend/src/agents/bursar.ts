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
import { evaluateBuyGate } from "../domain/gate.js";
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

  // Final deterministic pre-spend check on the external-submission path. Even
  // if a BUY verdict reaches us via a future code path or an upstream bug, the
  // gate runs again here before any real ETH moves. (The gate exempts the
  // $THESIS self-token by design; operator /admin spends are a separate,
  // secret-gated path that does not flow through here.)
  const gate = evaluateBuyGate(verdict.submission.contractAddress, verdict.tokenReport);
  if (!gate.allowed) {
    return { position: null, skippedReason: `hard gate: ${gate.reason}` };
  }

  const store = getStore();

  // --- Never double-expose to the same contract (L8) --------------------
  // Two theses about the same token (or a re-post) must not open a second
  // position: that doubles our exposure and splits the exit logic across two
  // positions the monitor tracks independently. Contract-scoped — a different
  // token is unaffected. Safe as a check-then-act because the poll loop is
  // single-flight (PR2 self-rescheduling loop), so no two buys race here.
  const contract = verdict.submission.contractAddress.toLowerCase();
  const alreadyHeld = (await store.getOpenPositions()).some(
    (p) => p.order.contractAddress.toLowerCase() === contract,
  );
  if (alreadyHeld) {
    return {
      position: null,
      skippedReason: "already holding an open position in this contract",
    };
  }

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
  // Buy on the AUTHORITATIVE chain resolved by the Auditor (DexScreener), not
  // the submission's address-shape guess — so we always trade the correct token
  // on the correct chain and size off that chain's wallet (ETH on Base, SOL on
  // Solana; the `*Eth` fields are native-per-chain).
  const tradeChain = verdict.tokenReport.chain;
  const chain = createChainAdapter(tradeChain);
  let portfolioEth: number;
  try {
    portfolioEth = await chain.getWalletBalanceEth();
  } catch (err) {
    // e.g. a Solana win on a Base-only live deployment with no Solana wallet
    // configured — skip cleanly rather than crash the review loop.
    return {
      position: null,
      skippedReason: `cannot read ${tradeChain} wallet: ${String(err)}`,
    };
  }
  const amountInEth = portfolioEth * verdict.positionSizePct;
  if (amountInEth <= 0) {
    return { position: null, skippedReason: "trading portfolio is empty" };
  }

  const order: TradeOrder = {
    contractAddress: verdict.submission.contractAddress,
    chain: tradeChain,
    amountInEth,
    takeProfits: config.trading.takeProfitTiers.map((t) => ({
      priceX: 1 + t.gainPct / 100,
      sellFraction: t.sellPct / 100,
    })),
    stopLossX: 1 - config.trading.stopLossPct / 100,
  };

  // F1 — write-ahead the buy intent so a crash BETWEEN the on-chain buy and the
  // savePosition below can't leave us with bought tokens and no Position record
  // (which would never be monitored — a silent, permanent loss). The service
  // logs any leftover marker on startup for manual reconciliation.
  await store.recordPendingBuy({
    postId: verdict.submission.postId,
    contractAddress: order.contractAddress,
    amountInEth,
    at: new Date().toISOString(),
  });
  let fill: Awaited<ReturnType<typeof chain.buy>>;
  try {
    fill = await chain.buy(order.contractAddress, order.amountInEth);
  } catch (err) {
    // Swap reverted before any tokens moved — drop the intent and propagate.
    await store.clearPendingBuy(verdict.submission.postId);
    throw err;
  }
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
  // Position durably persisted — the buy intent is fulfilled, drop the marker.
  await store.clearPendingBuy(verdict.submission.postId);

  return { position };
}
