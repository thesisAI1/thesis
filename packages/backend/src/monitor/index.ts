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
import type { AuthorPaymentInfo, LotteryPaymentInfo } from "../agents/endowment.js";
import { renderProfitCardSvg, type ProfitCardData } from "../cards/profit-card.js";
import { fetchAvatarAsDataUri, rasterise } from "../cards/render.js";
import { publish } from "../events.js";
import { settlePosition } from "../pipeline/index.js";
import { getStore } from "../store/index.js";
import { log } from "../util/log.js";
import { exitReplyText, payoutRequestText, payoutSentText } from "../util/replies.js";

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

/** Aging stop-loss — applies ONLY to positions that have never hit a
 *  take-profit tier. Progressively tightens as the position ages, so
 *  stagnant un-tiered bags can't sit at -20% indefinitely tying up
 *  capital. A position that proves momentum (TP1+) graduates out of
 *  aging and is governed by the standard trailing stop only.
 *
 *  Schedule:
 *    0-24h  →  no aging gate (standard trailing -30% applies)
 *    24-48h →  close if price < entry × 0.80  (-20%)
 *    48-72h →  close if price < entry × 0.90  (-10%)
 *    72h+   →  close if price < entry × 0.95  (-5%)
 *
 *  Returns the threshold multiplier (e.g. 0.80) when aging applies,
 *  or null when the position is outside the aging regime (too young,
 *  or already proven via tiersHit >= 1). */
function agingThreshold(pos: Position): number | null {
  if (pos.tiersHit > 0) return null;
  const ageMs = Date.now() - new Date(pos.openedAt).getTime();
  const ageHours = ageMs / 3_600_000;
  if (ageHours >= 72) return 0.95;
  if (ageHours >= 48) return 0.90;
  if (ageHours >= 24) return 0.80;
  return null;
}

async function processPosition(pos: Position, price: number): Promise<void> {
  // Aging stop-loss takes priority over both standard SL and TP — but
  // is only ever a tightening, so a healthy position never trips it.
  const aging = agingThreshold(pos);
  if (aging !== null && price < pos.entryPriceEth * aging) {
    await ageOut(pos, price);
    return;
  }
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

  // The closed state, savePosition, and settlement are now handled inside
  // takeTier() when the final tier fires — so the reply tweet can include
  // the author-payment line in the same post.
  if (pos.status !== "closed") {
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

  // Final tier closes the position. Mark + persist + settle BEFORE the reply
  // so the author-payment + holder-lottery lines can be folded into the
  // close-announcement tweet (single combined reply, not three separate ones).
  let settled: SettleResult | null = null;
  if (final) {
    pos.status = "closed";
    pos.closedAt = new Date().toISOString();
    await getStore().savePosition(pos);
    log.info(`monitor: ${pos.id} fully closed — all take-profit tiers cleared`);
    settled = await settle(pos);
  }

  await reply(
    pos,
    {
      kind: "tp",
      tier: tierNum,
      gainPct,
      sellPct: Math.round(tier.sellFraction * 100),
      proceedsEth: sale.proceeds,
      profitEth: sale.profit,
      final,
      txHash: sale.txHash,
    },
    settled?.authorPayment ?? null,
    settled?.lotteryPayment ?? null,
  );
  return true;
}

/** Stop-loss: sell the whole remaining position, close, and settle. */
async function stopOut(pos: Position): Promise<void> {
  await closeOutWithKind(pos, stopPrice(pos), "sl");
}

/** Aging close: position never hit a TP and now trips a time-tightened
 *  threshold (see agingThreshold). Same close pipeline as stopOut, just
 *  a distinct kind so the reply text can explain the real reason
 *  (age-based, not -30% trailing). */
async function ageOut(pos: Position, currentPrice: number): Promise<void> {
  await closeOutWithKind(pos, currentPrice, "aging");
}

/**
 * Close the remaining position at a given price and run the full
 * close pipeline: on-chain sell → save closed state → settle splits →
 * announce + card on X. Shared between automatic stop-out and the
 * author-triggered manual close. The `kind` parameter chooses the
 * announcement copy ("sl" / "manual") — same machinery underneath.
 *
 * Throws when the on-chain sell reverts (so callers can decide whether
 * to swallow the error or surface it to the user).
 */
async function closeOutWithKind(
  pos: Position,
  exitPrice: number,
  kind: "sl" | "manual" | "aging",
): Promise<void> {
  const cost = pos.order.amountInEth * pos.remainingFraction;

  // Manual close = author explicitly asked, so we earn the right to be
  // patient: 3 attempts spaced 30s apart, with progressive clamp + DEX
  // exclusion baked into the chain adapter. Total worst-case wait ≈90s,
  // comfortably within the author's expectation of "it's working on it"
  // and well below the next manual-close cooldown (60s anti-spam).
  // SL and aging stay single-attempt — they're automatic, no human
  // waiting, and a stale dust position doesn't need patient retries.
  const sellOpts =
    kind === "manual" ? { maxAttempts: 3, delayBetweenMs: 30_000 } : undefined;
  let sale: { proceeds: number; profit: number; txHash: string };
  try {
    sale = await sell(pos, cost, exitPrice, sellOpts);
  } catch (err) {
    if (kind === "manual") {
      // Surface to the author-actions caller so it can post a "try again" reply.
      log.warn(`monitor: ${pos.id} manual-close sell reverted: ${String(err)}`);
      throw err;
    }
    // Automatic SL / aging — same logic as takeTier: do NOT mark closed,
    // do NOT credit PnL, do NOT settle. Retry on the next monitor tick.
    log.warn(`monitor: ${pos.id} ${kind} sell reverted — will retry next tick: ${String(err)}`);
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
  const kindLabel =
    kind === "manual"
      ? "manually closed by author"
      : kind === "aging"
        ? "aged out (un-tiered, time-tightened SL)"
        : "stopped out";
  log.info(
    `monitor: ${pos.id} ${kindLabel} — net result ${total >= 0 ? "+" : ""}${total.toFixed(4)} ETH`,
  );
  // Settle first so we know how the author was paid (direct vs escrow vs
  // failed) AND who won the holder lottery — this gets folded into the
  // close-announcement tweet so the whole story lands as ONE reply.
  const settled = await settle(pos);
  // Aging closes carry the age + threshold so the reply text can explain
  // exactly why the position was cut (not "stop-loss triggered" — that
  // would misrepresent it. The trailing -30% didn't fire; the time-tightened
  // gate did, because the position never proved momentum).
  if (kind === "aging") {
    const ageHours =
      (Date.now() - new Date(pos.openedAt).getTime()) / 3_600_000;
    const aging = agingThreshold(pos) ?? 0.95;
    const thresholdPct = Math.round((1 - aging) * 100);
    await reply(
      pos,
      { kind, netPnlEth: total, ageHours, thresholdPct, txHash: sale.txHash },
      settled?.authorPayment ?? null,
      settled?.lotteryPayment ?? null,
    );
    return;
  }
  await reply(
    pos,
    { kind, netPnlEth: total, tiersHit: pos.tiersHit, txHash: sale.txHash },
    settled?.authorPayment ?? null,
    settled?.lotteryPayment ?? null,
  );
}

/**
 * Close an open position triggered by the original author via X reply.
 * The caller (pipeline/author-actions) is responsible for validating
 * authorship, the 20% profit threshold, and rate-limiting BEFORE
 * calling this. We re-check `pos.status === "open"` defensively to
 * avoid double-close races within the same poll cycle.
 *
 * On revert, throws — the caller will post a "try again" reply to the author.
 */
export async function closeByAuthor(pos: Position, currentPrice: number): Promise<void> {
  // Re-fetch from the store to defeat the in-memory race where another
  // close (TP4, SL, or a second close request) ran between validation
  // and this call.
  const all = await getStore().getAllPositions();
  const fresh = all.find((p) => p.id === pos.id);
  if (!fresh || fresh.status !== "open") {
    log.info(`monitor: closeByAuthor skipped — ${pos.id} no longer open`);
    return;
  }
  await closeOutWithKind(fresh, currentPrice, "manual");
}

/** Settlement outcome bundled for the caller. Both legs live in the same
 *  envelope so the close-announcement tweet can fold both into one reply. */
interface SettleResult {
  authorPayment: AuthorPaymentInfo;
  lotteryPayment: LotteryPaymentInfo | null;
}

/** Split the position's total realised profit 25/25/25/25 (once, at close).
 *  Returns the author + lottery payment outcomes so the caller can fold
 *  both into the close-announcement tweet (one combined reply). Returns
 *  null when not in profit (no settlement runs). */
async function settle(pos: Position): Promise<SettleResult | null> {
  if (pos.realisedPnlEth <= 0) return null;
  const result = await settlePosition(pos, pos.realisedPnlEth);
  if (!result) return null;
  await getStore().saveDistribution(result.distribution);
  publish({
    type: "endowment",
    positionId: result.distribution.positionId,
    authorHandle: pos.authorHandle,
    totalProfitEth: result.distribution.totalProfitEth,
    toAuthorEth: result.distribution.toAuthorEth,
    toBuybackEth: result.distribution.toBuybackEth,
    authorWallet: result.distribution.authorWallet,
  });
  return { authorPayment: result.authorPayment, lotteryPayment: result.lotteryPayment };
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
  opts?: { maxAttempts?: number; delayBetweenMs?: number },
): Promise<{ proceeds: number; profit: number; txHash: string }> {
  const originalTokens =
    pos.entryPriceEth > 0 ? pos.order.amountInEth / pos.entryPriceEth : 0;
  const tokens =
    pos.order.amountInEth > 0 ? originalTokens * (costEth / pos.order.amountInEth) : 0;

  // opts pass-through is used by the manual-close path: the author asked us
  // to keep trying through any transient Clanker anti-MEV / transfer-tax
  // reverts. TP/SL callers leave opts undefined and let the next monitor
  // tick re-attempt (faster recovery when price is moving).
  const result = await createChainAdapter().sell(pos.order.contractAddress, tokens, opts);
  // result.amountOut is the ETH the wallet actually received from KyberSwap.
  // exitPrice is kept in the signature only so the call sites stay
  // self-documenting (which tier triggered us); we no longer multiply by it.
  const proceeds = result.amountOut;
  return { proceeds, profit: proceeds - costEth, txHash: result.txHash };
}

/** Announce an exit on the original X post. Profitable exits also attach a
 *  generated share card image (V3 design). Pure-loss stop-outs stay text-only
 *  — no card to celebrate a loss.
 *
 *  When `authorPayment` is provided (full close in profit), the payment line
 *  is folded into the same tweet — so the author sees one combined reply
 *  with the close summary + card + their payment status, not two posts. */
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
    | { kind: "sl"; netPnlEth: number; tiersHit: number; txHash: string }
    | { kind: "manual"; netPnlEth: number; tiersHit: number; txHash: string }
    | { kind: "aging"; netPnlEth: number; ageHours: number; thresholdPct: number; txHash: string },
  authorPayment: AuthorPaymentInfo | null = null,
  lotteryPayment: LotteryPaymentInfo | null = null,
): Promise<void> {
  const x = createXAdapter();
  const text = buildClosingText(pos, o, authorPayment, lotteryPayment);
  // The card represents the FULL settlement story — author share, $THESIS
  // burn, the lot. Real settlement only runs at full close (TP4 final, or any
  // stop-out). Per-tier intermediate exits don't settle anything yet, so we
  // mustn't post a card claiming "shared / earned / burned" when none of that
  // has happened. Gate the card to fire exactly when settle() does.
  // Manual closes are always validated as profitable by the caller, so they
  // always get a card. Aging closes are always at a loss (the gate only fires
  // sub-entry), so no card.
  const fullyClosed =
    (o.kind === "tp" && o.final && pos.realisedPnlEth > 0) ||
    (o.kind === "sl" && pos.realisedPnlEth > 0) ||
    (o.kind === "manual" && pos.realisedPnlEth > 0);

  let mediaPng: Buffer | null = null;
  if (fullyClosed) {
    try {
      mediaPng = await buildProfitCardPng(pos, o);
    } catch (err) {
      log.warn(`x: card render failed for ${pos.id}, falling back to text-only: ${String(err)}`);
    }
  }

  let replyId = "";
  try {
    replyId = mediaPng
      ? await x.replyToPostWithMedia(pos.postId, text, mediaPng)
      : await x.replyToPost(pos.postId, text);
    log.info(
      `x: replied to ${pos.postId} (${o.kind}${mediaPng ? " + card" : ""}) — reply ${replyId}`,
    );
  } catch (err) {
    log.warn(`x: exit reply failed for ${pos.postId}: ${String(err)}`);
  }

  // If the author share is escrowed (no wallet on file), we MUST have a
  // tweet they can reply to with their wallet — otherwise the wallet-reply
  // handler has nothing to match against and the escrow sits orphaned
  // forever. Layered defence:
  //   1. Normal path — the close announcement IS the request, register its id.
  //   2. Close tweet failed (X 403, network error, etc.) — post a simpler
  //      fallback "we owe you, please send wallet" tweet with no card and no
  //      crypto addresses in the copy. Register THAT id.
  //   3. Fallback tweet also failed — register the request against the
  //      original thesis post id. The author can still reply there with a
  //      wallet (their thread already tagged @thesis_agent, so the reply
  //      will appear in our mentions) and we'll match it.
  // Net effect: an escrowed author ALWAYS has a path to claim their share,
  // even if every outbound tweet attempt fails.
  if (authorPayment && authorPayment.kind === "escrowed") {
    let requestTweetId = replyId;

    if (!requestTweetId) {
      log.warn(
        `x: close reply failed for ${pos.id} — posting fallback payout request`,
      );
      try {
        requestTweetId = await x.replyToPost(
          pos.postId,
          payoutRequestText({
            handle: pos.authorHandle,
            amountEth: authorPayment.amountEth,
          }),
        );
        log.info(`x: posted fallback payout request — reply ${requestTweetId}`);
      } catch (err) {
        log.error(
          `x: fallback payout request also failed for ${pos.id}: ${String(err)}`,
        );
      }
    }

    const finalRequestTweetId = requestTweetId || pos.postId;
    await getStore().addPayoutRequest({
      requestTweetId: finalRequestTweetId,
      xUserId: pos.authorXId,
      handle: pos.authorHandle,
      threadPostId: pos.postId,
      requestedAt: new Date().toISOString(),
    });
    log.info(
      `endowment: ${pos.authorHandle} payout request bound to tweet ${finalRequestTweetId} ` +
        `(${finalRequestTweetId === pos.postId ? "fallback to original thesis post — both tweet attempts failed" : finalRequestTweetId === replyId ? "via close announcement" : "via fallback request post"}) ` +
        `— escrow ${authorPayment.amountEth.toFixed(4)} ETH`,
    );
  }
}

/** Compose the close-announcement text by combining the standard exit
 *  reply with the author-payment line. Keeps both halves of the story
 *  in one tweet so the author doesn't see two notifications. */
function buildClosingText(
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
    | { kind: "sl"; netPnlEth: number; tiersHit: number; txHash: string }
    | { kind: "manual"; netPnlEth: number; tiersHit: number; txHash: string }
    | { kind: "aging"; netPnlEth: number; ageHours: number; thresholdPct: number; txHash: string },
  authorPayment: AuthorPaymentInfo | null,
  lotteryPayment: LotteryPaymentInfo | null,
): string {
  const base = exitReplyText(o);
  const parts: string[] = [base];

  if (authorPayment) {
    parts.push("");
    if (authorPayment.kind === "direct") {
      parts.push(
        payoutSentText({
          handle: pos.authorHandle,
          amountEth: authorPayment.amountEth,
          wallet: authorPayment.wallet,
          txHash: authorPayment.txHash,
        }),
      );
    } else if (authorPayment.kind === "escrowed") {
      parts.push(
        payoutRequestText({
          handle: pos.authorHandle,
          amountEth: authorPayment.amountEth,
        }),
      );
    } else {
      parts.push(
        `Heads up: the author payout leg hit a snag (${authorPayment.reason}). Will retry — you're not losing anything.`,
      );
    }
  }

  // Lottery winners line — surfaces the 5 random holders who just earned a
  // share. We append it as a separate stanza so the tweet reads as three
  // clean sections (close summary, author payment, holder lottery).
  const lotteryLine = formatLotteryLine(lotteryPayment);
  if (lotteryLine) {
    parts.push("");
    parts.push(lotteryLine);
  }

  return parts.join("\n");
}

/** Format the lottery payment as a single multi-line block for the close
 *  tweet. Returns "" when no lottery info is present or nobody actually
 *  won (so the caller can decide whether to append at all).
 *
 *  IMPORTANT: this used to include the FULL 0x addresses of every winner
 *  for verifiability, but X (Twitter) blocks tweets containing wallet
 *  addresses for the first ~7 days after a new app authentication, with a
 *  403 "Crypto addresses are prohibited" error. That killed every close
 *  announcement until we noticed. We now describe the lottery in words
 *  only — the trading wallet's BaseScan address (already linked from the
 *  homepage) shows every winner's inbound transfer for self-verification. */
function formatLotteryLine(info: LotteryPaymentInfo | null): string {
  if (!info || info.paid.length === 0) return "";
  const per = info.paid[0].amountEth; // equal split, all the same
  return [
    `🎲 Holder lottery: ${info.paid.length} random $THESIS holders won ${per.toFixed(4)} Ξ each (pool of ${info.eligibleCount} eligibles).`,
    `Winners visible on the trading wallet's recent BaseScan transfers.`,
  ].join("\n");
}

/** Build the profit-close share card PNG for this exit. Pulls the position's
 *  data + symbol + author avatar, hands to the SVG template, rasterises. */
async function buildProfitCardPng(
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
    | { kind: "sl"; netPnlEth: number; tiersHit: number; txHash: string }
    | { kind: "manual"; netPnlEth: number; tiersHit: number; txHash: string }
    | { kind: "aging"; netPnlEth: number; ageHours: number; thresholdPct: number; txHash: string },
): Promise<Buffer> {
  const adapter = createBaseDataAdapter();
  const symbol = await adapter.getTokenSymbol(pos.order.contractAddress).catch(() => "");

  // We need an entry MC + an exit MC. The position stores entry MC at buy
  // time; exit MC is derived from the entry MC × (exit price / entry price).
  //
  // For positions opened BEFORE marketCapAtEntryUsd existed, entry MC is
  // null — we then fall back to querying the live token snapshot from
  // Birdeye/DexScreener, which gives us the CURRENT MC. That current MC
  // is the natural "exit" MC (the price right after we sold), and we then
  // derive the entry MC by reversing the same price ratio.
  let entryMarketCapUsd = pos.marketCapAtEntryUsd ?? null;
  let exitMarketCapUsd: number | null = null;

  if (entryMarketCapUsd !== null && pos.entryPriceEth > 0 && pos.lastExitPriceEth != null) {
    exitMarketCapUsd = entryMarketCapUsd * (pos.lastExitPriceEth / pos.entryPriceEth);
  } else if (pos.entryPriceEth > 0 && pos.lastExitPriceEth != null) {
    // Fallback for pre-redesign positions — pull live MC, treat it as exit MC,
    // back-derive entry MC from the price ratio.
    try {
      const live = await adapter.getToken(pos.order.contractAddress);
      if (live.marketCapUsd > 0) {
        exitMarketCapUsd = live.marketCapUsd;
        entryMarketCapUsd = live.marketCapUsd * (pos.entryPriceEth / pos.lastExitPriceEth);
      }
    } catch (err) {
      log.warn(`card: live MC fallback failed for ${pos.id}: ${String(err)}`);
    }
  }

  // Card always surfaces the FULL realised PnL across all tiers (not just
  // the last exit's slice). This is only called at full-close, where
  // pos.realisedPnlEth holds the total banked across every tranche.
  const totalProfitEth = pos.realisedPnlEth;
  const authorShareEth = totalProfitEth > 0 ? totalProfitEth * 0.25 : 0;
  const buybackEth = authorShareEth; // same 25% slice.
  const pnlPct =
    pos.order.amountInEth > 0 ? (totalProfitEth / pos.order.amountInEth) * 100 : 0;

  // Map the monitor's exit-event union onto the card's exit type so the
  // headline copy matches the actual trigger (TP / trailing stop / author
  // manual close).
  let exit: ProfitCardData["exit"];
  if (o.kind === "tp") {
    exit = { kind: "tp", tier: o.tier, gainPct: o.gainPct, final: o.final };
  } else if (o.kind === "manual") {
    exit = { kind: "manual", tiersHit: o.tiersHit };
  } else if (o.kind === "sl") {
    exit = { kind: "trail", tiersHit: o.tiersHit };
  } else {
    // Aging closes are always at a loss (the gate only fires sub-entry),
    // so the card is never built for them — see fullyClosed in reply().
    // This branch only exists to satisfy the type narrower; it should
    // never actually execute in practice.
    exit = { kind: "trail", tiersHit: 0 };
  }

  const data: ProfitCardData = {
    tokenSymbol: symbol,
    authorHandle: pos.authorHandle,
    authorAvatarUrl: pos.authorAvatarUrl,
    totalProfitEth,
    pnlPct,
    entryMarketCapUsd: pos.marketCapAtEntryUsd ?? null,
    exitMarketCapUsd,
    authorShareEth,
    buybackEth,
    exit,
  };

  const avatarDataUri = await fetchAvatarAsDataUri(data.authorAvatarUrl);
  const svg = renderProfitCardSvg(data, avatarDataUri ?? undefined);
  return rasterise(svg);
}
