/**
 * THE ENDOWMENT — the treasury.
 *
 * Settles a position's total realised profit by splitting it four ways
 * (25/25/25/25) and executing each leg on-chain:
 *   - 25% Author    -> the author (see below)
 *   - 25% Portfolio -> stays in the trading wallet, compounding
 *   - 25% Team      -> the team / maintenance wallet
 *   - 25% Buyback   -> buys $THESIS and burns it
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

import type { Distribution, Position, RegistryEntry } from "@thesis/shared";
import { createChainAdapter } from "../adapters/chain/index.js";
import { createXAdapter } from "../adapters/x/index.js";
import { config, useMock } from "../config.js";
import { getStore } from "../store/index.js";
import { log } from "../util/log.js";
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
export async function runEndowment(
  position: Position,
  profitEth: number,
  options: { silentAuthorTweet?: boolean } = {},
): Promise<EndowmentResult | null> {
  if (profitEth <= 0) return null;

  const quarter = profitEth / 4;
  const store = getStore();
  const chain = createChainAdapter();
  const entry = await store.getRegistryEntry(position.authorXId);

  // 25% — the author. Pay a known wallet directly, or escrow + ask on X.
  let authorPayment: AuthorPaymentInfo;
  if (entry) {
    authorPayment = await payAuthorDirect(
      position,
      entry,
      quarter,
      options.silentAuthorTweet === true,
    );
  } else {
    await store.addEscrow(position.authorXId, position.authorHandle, quarter);
    if (!options.silentAuthorTweet) {
      await requestAuthorPayout(position);
    }
    // The escrow amount in the payout-request copy is the CUMULATIVE total
    // (this close + any prior unanswered closes) — that's what the author
    // actually has waiting, not just the latest tranche.
    const updated = await store.getEscrow(position.authorXId);
    const totalOwed = updated?.amountEth ?? quarter;
    authorPayment = {
      kind: "escrowed",
      amountEth: totalOwed,
      handle: position.authorHandle,
    };
  }

  // 25% — the team / maintenance wallet.
  if (useMock() || config.chain.teamWallet) {
    await runLeg("pay team", () => chain.sendEth(config.chain.teamWallet, quarter));
  }

  // 25% — buy back $THESIS and burn it.
  if (useMock() || config.chain.thesisToken) {
    await runLeg("buyback & burn $THESIS", () =>
      chain.buybackAndBurn(quarter).then((r) => r.txHash),
    );
  }

  // 25% — the trading portfolio: the profit already sits in the wallet.

  return {
    distribution: {
      positionId: position.id,
      totalProfitEth: profitEth,
      toAuthorEth: quarter,
      toPortfolioEth: quarter,
      toTeamEth: quarter,
      toBuybackEth: quarter,
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
    txHash = await createChainAdapter().sendEth(entry.wallet, amountEth);
  } catch (err) {
    const reason = String(err);
    log.error(`endowment: author payout failed for ${entry.handle} — ${reason}`);
    return { kind: "failed", reason, amountEth };
  }
  log.info(
    `endowment: paid author ${entry.handle} ${amountEth.toFixed(4)} ETH — tx ${txHash}`,
  );
  if (!silent) {
    try {
      const replyId = await createXAdapter().replyToPost(
        position.postId,
        payoutSentText({ handle: position.authorHandle, amountEth, wallet: entry.wallet, txHash }),
      );
      log.info(`x: replied to ${position.postId} confirming author payout (reply ${replyId})`);
    } catch (err) {
      log.warn(`x: payout-sent reply failed for ${position.postId}: ${String(err)}`);
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
  const escrow = await store.getEscrow(position.authorXId);
  const owed = escrow?.amountEth ?? 0;

  try {
    const requestTweetId = await createXAdapter().replyToPost(
      position.postId,
      payoutRequestText({ handle: position.authorHandle, amountEth: owed }),
    );
    await store.addPayoutRequest({
      requestTweetId,
      xUserId: position.authorXId,
      handle: position.authorHandle,
      threadPostId: position.postId,
      requestedAt: new Date().toISOString(),
    });
    log.info(
      `endowment: ${position.authorHandle} payout request posted — total escrow ${owed.toFixed(4)} ETH (tweet ${requestTweetId})`,
    );
  } catch (err) {
    log.error(
      `endowment: payout request post failed for ${position.authorHandle} — ${String(err)}`,
    );
  }
}

/** Run one on-chain leg; log the outcome without aborting settlement. */
async function runLeg(label: string, exec: () => Promise<string>): Promise<void> {
  try {
    const txHash = await exec();
    log.info(`endowment: ${label} — tx ${txHash}`);
  } catch (err) {
    log.error(`endowment: ${label} failed — ${String(err)}`);
  }
}
