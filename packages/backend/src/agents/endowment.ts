/**
 * THE ENDOWMENT — the treasury.
 *
 * Settles a position's total realised profit by splitting it three ways
 * (25/50/25) and executing each paying leg on-chain:
 *   - 25% Author    -> the author (see below)
 *   - 50% Portfolio -> stays in the trading wallet, compounding (this includes
 *                      the retired holder-lottery quarter)
 *   - 25% Buyback   -> buys $THESIS and burns it (Base); on Solana it accrues
 *                      in SOLANA_BUYBACK_WALLET for a manual buyback→burn
 *
 * The author leg is paid entirely on X — there is no website registration:
 *   - if the author already has a payout wallet on file, the share is sent
 *     straight to it and a tx-link reply is posted;
 *   - otherwise the share is escrowed and the agent replies to the author's
 *     thesis asking them to reply with a Base wallet address. The wallet
 *     reply is honoured by the poll loop (see ../payout) only when it comes
 *     from the original author, so the payout cannot be hijacked.
 *
 * Every on-chain leg is gated (LIVE_TRADING_ARMED) and mock-safe.
 */

import type { Chain, Distribution, Position, RegistryEntry, SettlementProgress } from "@thesis/shared";
import { recordActivity } from "../activity.js";
import { createChainAdapter } from "../adapters/chain/index.js";
import { createXAdapter } from "../adapters/x/index.js";
import { config, useMock } from "../config.js";
import { getStore } from "../store/index.js";
import { log, logEvent } from "../util/log.js";
import { payoutRequestText, payoutSentText } from "../util/replies.js";

/** Outcome of the author leg, returned to the caller so it can fold the
 *  payment line into the close-announcement tweet (one combined reply
 *  instead of two separate ones). */
export type AuthorPaymentInfo =
  | { kind: "direct"; wallet: string; txHash: string; amountEth: number }
  | { kind: "escrowed"; amountEth: number; handle: string }
  | { kind: "failed"; reason: string; amountEth: number };

export interface EndowmentResult {
  distribution: Distribution;
  authorPayment: AuthorPaymentInfo;
}

/**
 * Split and pay out a position's total realised profit. Returns null if
 * not in profit.
 *
 * When `silentAuthorTweet` is true, the author leg runs (on-chain send
 * or escrow), but the corresponding X reply is NOT posted from here —
 * the caller (monitor.reply) folds the payment status into the close
 * announcement so the whole settlement lands as ONE tweet with the card
 * and the payment line together.
 *
 * When `silentAuthorTweet` is false / unset, behaviour is unchanged
 * (legacy path posts the author tweet inline). All current callers pass
 * true; the option is kept for backwards compat / future flexibility.
 */
/**
 * Per-chain settlement policy for the buyback quarter.
 *
 *   Base   — buyback-and-burn of $THESIS (the deflationary mechanic).
 *   Solana — NO $THESIS burn (there is no $THESIS on Solana); the
 *            buyback-substitute slice is sent in SOL to SOLANA_BUYBACK_WALLET,
 *            the operator's designated collection wallet, for a later manual
 *            bridge→buyback→burn.
 */
export function settlementPolicy(chain: Chain): { useBurn: boolean } {
  if (chain === "solana") return { useBurn: false };
  return { useBurn: true };
}

export async function runEndowment(
  position: Position,
  profitEth: number,
  options: { silentAuthorTweet?: boolean } = {},
): Promise<EndowmentResult | null> {
  if (profitEth <= 0) return null;

  const quarter = profitEth / 4;
  const store = getStore();
  // Settle on the position's own chain — SOL legs for a Solana win, ETH for Base.
  const chain = createChainAdapter(position.order.chain);
  const policy = settlementPolicy(position.order.chain);
  const entry = await store.getRegistryEntry(position.authorXId, position.order.chain);

  // PR3 — idempotent settlement. Each leg is gated on a persisted marker, and
  // progress is saved after each leg, so a settlement interrupted by a transient
  // send/RPC failure (or a crash) RESUMES on the next monitor tick and re-runs
  // ONLY the legs that have not yet succeeded — the author and buyback are each
  // paid exactly once, never twice.
  const progress: SettlementProgress = {
    authorDone: false,
    buybackDone: false,
    distributionDone: false,
    ...(position.settlement ?? {}),
  };
  const saveProgress = async (): Promise<void> => {
    position.settlement = progress;
    await store.savePosition(position);
  };

  // 25% — the author. Pay a known wallet directly, or escrow + ask on X.
  let authorPayment: AuthorPaymentInfo;
  if (progress.authorDone) {
    // Already paid/escrowed on an earlier attempt — the close tweet went out
    // then too. Reconstruct a benign descriptor for the return value.
    authorPayment = entry
      ? { kind: "direct", wallet: entry.wallet, txHash: "", amountEth: quarter }
      : { kind: "escrowed", amountEth: quarter, handle: position.authorHandle };
  } else {
    if (entry) {
      authorPayment = await payAuthorDirect(
        position,
        entry,
        quarter,
        options.silentAuthorTweet === true,
      );
    } else {
      await store.addEscrow(position.authorXId, position.authorHandle, quarter, position.order.chain);
      // addEscrow ADDS to the author's running escrow total, so it must never
      // run twice. Persist authorDone in the very next write — BEFORE the
      // payout-request tweet and the getEscrow read below — so a crash can't let
      // the monitor's resume pass re-run this leg and re-add the escrow,
      // over-paying the author on claim. (Residual: a crash inside this single
      // write is the same accepted at-least-once risk as a direct send that
      // lands on-chain then crashes before its marker persists.)
      progress.authorDone = true;
      await saveProgress();
      if (!options.silentAuthorTweet) {
        await requestAuthorPayout(position);
      }
      // The escrow amount in the payout-request copy is the CUMULATIVE total
      // (this close + any prior unanswered closes) — that's what the author
      // actually has waiting, not just the latest tranche.
      const updated = await store.getEscrow(position.authorXId, position.order.chain);
      const totalOwed = updated?.amountEth ?? quarter;
      authorPayment = {
        kind: "escrowed",
        amountEth: totalOwed,
        handle: position.authorHandle,
      };
    }
    // Mark done ONLY on real success. A failed direct payout returns
    // {kind:"failed"} (not a throw), so leave authorDone false and let the
    // monitor retry next tick rather than stranding the author unpaid.
    if (authorPayment.kind !== "failed") {
      progress.authorDone = true;
      await saveProgress();
    }
  }

  // 50% — the trading portfolio: the profit already sits in the wallet, so
  // there is no leg to run. (This includes the retired holder-lottery quarter,
  // which now compounds here instead of paying out to random holders.)
  const buybackBudget = quarter;

  // 25% — buy back $THESIS and burn it (Base), or send the buyback-substitute
  // slice in SOL to the Solana wallet (Solana — no $THESIS exists there to burn).
  if (!progress.buybackDone) {
    // policy.useBurn is false exactly for Solana — there is no $THESIS to burn,
    // so the buyback-substitute slice is sent in SOL to SOLANA_BUYBACK_WALLET.
    if (!policy.useBurn) {
      if (useMock() || config.solana.buybackWallet) {
        const ok = await runLeg("solana buyback → wallet (SOL)", () =>
          chain.sendEth(config.solana.buybackWallet, buybackBudget),
          position.id,
        );
        if (ok) {
          progress.buybackDone = true;
          await saveProgress();
          recordActivity({
            kind: "burn",
            summary: `◎ ${buybackBudget.toFixed(4)} SOL → buyback wallet (no $THESIS on Solana to burn)`,
            positionId: position.id,
            amountEth: buybackBudget,
          });
        }
      } else {
        // Live Solana win, SOLANA_BUYBACK_WALLET unset — leave buybackDone false
        // so the slice is paid once the wallet is configured (don't silently drop).
        log.warn(
          `endowment: ${position.id} Solana buyback slice unpaid — SOLANA_BUYBACK_WALLET unset`,
        );
      }
    } else if (useMock() || config.chain.thesisToken) {
      const ok = await runLeg("buyback & burn $THESIS", () =>
        chain.buybackAndBurn(buybackBudget).then((r) => r.txHash),
        position.id,
      );
      if (ok) {
        progress.buybackDone = true;
        await saveProgress();
        // Ticker activity for the burn — the deflationary narrative deserves
        // a visible event each time the wallet permanently removes supply.
        recordActivity({
          kind: "burn",
          summary: `🔥 Buyback + burn ${buybackBudget.toFixed(4)} Ξ of $THESIS`,
          positionId: position.id,
          amountEth: buybackBudget,
        });
      }
    } else {
      // Not applicable in this config — mark done so settlement can finalise.
      progress.buybackDone = true;
      await saveProgress();
    }
  }

  return {
    distribution: {
      positionId: position.id,
      totalProfitEth: profitEth,
      toAuthorEth: quarter,
      toPortfolioEth: quarter * 2,
      toBuybackEth: buybackBudget,
      authorWallet: entry ? entry.wallet : null,
    },
    authorPayment,
  };
}

/** Pay an author whose payout wallet is already on file. Returns the
 *  outcome so the caller can include it in the close announcement. When
 *  `silent` is false, a standalone "payout sent" tweet is posted in-thread
 *  (legacy behaviour). When true, the caller takes responsibility for
 *  announcing the payment. */
async function payAuthorDirect(
  position: Position,
  entry: RegistryEntry,
  amountEth: number,
  silent: boolean,
): Promise<AuthorPaymentInfo> {
  let txHash: string;
  try {
    txHash = await createChainAdapter(position.order.chain).sendEth(entry.wallet, amountEth);
  } catch (err) {
    const reason = String(err);
    log.error(`endowment: author payout failed for ${entry.handle} — ${reason}`);
    logEvent({
      level: "error",
      area: "endowment",
      type: "author-payout:failed",
      msg: `endowment: author payout failed for ${entry.handle} — ${reason}`,
      ops: {
        type: "payout:failed",
        at: new Date().toISOString(),
        chain: position.order.chain,
        handle: entry.handle,
        amountEth,
        reason,
      },
    });
    return { kind: "failed", reason, amountEth };
  }
  logEvent({
    level: "info",
    area: "endowment",
    type: "author-payout:sent",
    msg: `endowment: paid author ${entry.handle} ${amountEth.toFixed(4)} ETH — tx ${txHash}`,
    ops: { type: "payout:sent", at: new Date().toISOString(), path: "direct", chain: position.order.chain, handle: entry.handle, amountEth, wallet: entry.wallet, txHash },
  });
  if (!silent) {
    try {
      const replyId = await createXAdapter().replyToPost(
        position.postId,
        payoutSentText({ handle: position.authorHandle, amountEth, wallet: entry.wallet, txHash }),
      );
      log.info(`x: replied to ${position.postId} confirming author payout (reply ${replyId})`);
    } catch (err) {
      log.warn(`x: payout-sent reply failed for ${position.postId}: ${String(err)}`);
      logEvent({
        level: "warn",
        area: "endowment",
        type: "payout-sent-reply:failed",
        msg: `x: payout-sent reply failed for ${position.postId}: ${String(err)}`,
      });
    }
  }
  return { kind: "direct", wallet: entry.wallet, txHash, amountEth };
}

/**
 * Escrowed an unregistered author's share — ask them, on their own thesis,
 * to reply with a Base wallet. Every settlement gets its own request post on
 * the new position's thread, even if previous requests are still open. Any
 * one of the open requests can be answered to claim the FULL escrow (the
 * payout handler clears every open request for the author on a successful
 * reply, so duplicate claims are impossible).
 */
async function requestAuthorPayout(position: Position): Promise<void> {
  const store = getStore();
  const escrow = await store.getEscrow(position.authorXId, position.order.chain);
  const owed = escrow?.amountEth ?? 0;

  try {
    const requestTweetId = await createXAdapter().replyToPost(
      position.postId,
      payoutRequestText({
        handle: position.authorHandle,
        amountEth: owed,
        chain: position.order.chain,
      }),
    );
    await store.addPayoutRequest({
      requestTweetId,
      xUserId: position.authorXId,
      handle: position.authorHandle,
      threadPostId: position.postId,
      requestedAt: new Date().toISOString(),
      chain: position.order.chain,
    });
    log.info(
      `endowment: ${position.authorHandle} payout request posted — total escrow ${owed.toFixed(4)} ETH (tweet ${requestTweetId})`,
    );
  } catch (err) {
    const handle = position.authorHandle;
    log.error(
      `endowment: payout request post failed for ${handle} — ${String(err)}`,
    );
    logEvent({
      level: "error",
      area: "endowment",
      type: "payout-request-post:failed",
      msg: `endowment: payout request post failed for ${handle} — ${String(err)}`,
      ops: {
        type: "error",
        at: new Date().toISOString(),
        area: "endowment",
        msg: `payout request post failed for ${handle}`,
      },
    });
  }
}

/** Run one on-chain leg; log the outcome without aborting settlement. Returns
 *  true if the leg succeeded, false if it threw — the caller uses this to mark
 *  the leg done (skip it on a retry) or leave it for retry. */
async function runLeg(label: string, run: () => Promise<string>, positionId: string): Promise<boolean> {
  try {
    const txHash = await run();
    log.info(`endowment: ${label} — tx ${txHash}`);
    return true;
  } catch (err) {
    log.error(`endowment: ${label} failed — ${String(err)}`);
    logEvent({
      level: "error",
      area: "endowment",
      type: "settle-leg:failed",
      msg: `endowment: ${label} failed — ${String(err)}`,
      ops: {
        type: "settle:failed",
        at: new Date().toISOString(),
        positionId,
        reason: `${label}: ${String(err)}`,
      },
    });
    return false;
  }
}
