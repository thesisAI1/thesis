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
import { drawLottery } from "../holders/index.js";
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

/** Outcome of the holder lottery — who won, how much each, plus the size
 *  of the eligible pool at draw time. Folded into the close tweet so the
 *  announcement reads "5 random holders won X each from a pool of Y". */
export interface LotteryPaymentInfo {
  /** Individual winner payouts that actually went through on-chain. */
  paid: Array<{ wallet: string; amountEth: number; txHash: string }>;
  /** Winner picks that reverted on the send (RPC failure etc.). Carried
   *  back so the close tweet can mention the affected count if any. */
  failed: Array<{ wallet: string; amountEth: number; reason: string }>;
  /** How many wallets were eligible at draw time — useful copy fodder. */
  eligibleCount: number;
  /** ETH that couldn't be distributed (lottery disabled, no eligibles,
   *  or every send reverted). Added to the buyback budget so it never
   *  sits idle. */
  undistributedEth: number;
}

export interface EndowmentResult {
  distribution: Distribution;
  authorPayment: AuthorPaymentInfo;
  /** Null when the lottery is disabled in config OR the trade fell back to
   *  the classic team payout (e.g. no eligibles at all). */
  lotteryPayment: LotteryPaymentInfo | null;
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

  // 25% — holder lottery (or classic team payout, depending on config).
  //
  // With HOLDER_LOTTERY_ENABLED, the team slice splits across N=5 random
  // eligible $THESIS holders, 5% each. Any ETH we can't distribute (lottery
  // off, no eligibles, sends revert) is folded into the buyback budget for
  // THIS close — never left sitting in the wallet. With the lottery off,
  // behaviour falls back to the legacy single transfer to TEAM_WALLET.
  let lotteryPayment: LotteryPaymentInfo | null = null;
  let teamPaidEth = 0;
  let buybackBudget = quarter; // base buyback slice; may be topped up below
  if (config.holderLottery.enabled) {
    const result = await runHolderLottery(position, quarter, chain);
    lotteryPayment = result;
    teamPaidEth = result.paid.reduce((s, p) => s + p.amountEth, 0);
    // Any winner who failed OR any leftover (lottery off / no eligibles)
    // gets rolled into the buyback so the full 25% still pulls weight.
    buybackBudget += result.undistributedEth;
  } else if (useMock() || config.chain.teamWallet) {
    await runLeg("pay team", () => chain.sendEth(config.chain.teamWallet, quarter));
    teamPaidEth = quarter;
  }

  // 25% (+ any undistributed lottery ETH) — buy back $THESIS and burn it.
  if (useMock() || config.chain.thesisToken) {
    await runLeg("buyback & burn $THESIS", () =>
      chain.buybackAndBurn(buybackBudget).then((r) => r.txHash),
    );
  }

  // 25% — the trading portfolio: the profit already sits in the wallet.

  return {
    distribution: {
      positionId: position.id,
      totalProfitEth: profitEth,
      toAuthorEth: quarter,
      toPortfolioEth: quarter,
      toTeamEth: teamPaidEth,
      toBuybackEth: buybackBudget,
      authorWallet: entry ? entry.wallet : null,
    },
    authorPayment,
    lotteryPayment,
  };
}

/**
 * Run the holder lottery for one settlement. Draws N random eligible $THESIS
 * holders (uniform, seeded by the close tx hash), splits the team slice
 * equally between them, and dispatches the on-chain sends sequentially so a
 * single revert doesn't abort the rest. Returns a tally the caller folds
 * into the close announcement tweet.
 */
async function runHolderLottery(
  position: Position,
  slice: number,
  chain: ReturnType<typeof createChainAdapter>,
): Promise<LotteryPaymentInfo> {
  const winnersWanted = Math.max(1, config.holderLottery.winnersPerTrade);
  // Seed needs to be a 0x-hex string. The close tx hash is the natural
  // choice — published in the tweet and on BaseScan, so anyone can verify.
  const seed = position.lastExitTxHash;
  if (!seed) {
    log.warn(
      `endowment: lottery skipped for ${position.id} — no lastExitTxHash to seed the random pick`,
    );
    return { paid: [], failed: [], eligibleCount: 0, undistributedEth: slice };
  }
  // Skip our own trading wallet in case it qualifies (we'd be paying
  // ourselves). The address comes from the chain adapter at runtime.
  let ourWallet = "";
  try {
    ourWallet = chain.getWalletAddress();
  } catch {
    /* mock or misconfigured — pass empty exclude */
  }
  const draw = await drawLottery(winnersWanted, seed, ourWallet);
  if (draw.winners.length === 0) {
    log.warn(
      `endowment: lottery for ${position.id} — no eligible holders (pool 0). ` +
        `Slice (${slice.toFixed(4)} ETH) goes to buyback.`,
    );
    return { paid: [], failed: [], eligibleCount: 0, undistributedEth: slice };
  }
  // Equal split across actual winners — if we asked for 5 but only got 3
  // eligibles, each of the 3 gets a third of the slice (not a fifth).
  const perWinner = slice / draw.winners.length;
  const paid: LotteryPaymentInfo["paid"] = [];
  const failed: LotteryPaymentInfo["failed"] = [];
  for (const winner of draw.winners) {
    try {
      const txHash = await chain.sendEth(winner, perWinner);
      paid.push({ wallet: winner, amountEth: perWinner, txHash });
      log.info(
        `endowment: lottery paid ${winner} ${perWinner.toFixed(4)} ETH — tx ${txHash}`,
      );
    } catch (err) {
      const reason = String(err);
      failed.push({ wallet: winner, amountEth: perWinner, reason });
      log.error(`endowment: lottery send to ${winner} failed — ${reason}`);
    }
  }
  const undistributedEth = failed.reduce((s, f) => s + f.amountEth, 0);
  log.info(
    `endowment: lottery for ${position.id} — paid ${paid.length}/${draw.winners.length} winners ` +
      `(${perWinner.toFixed(4)} ETH each, pool ${draw.eligibleCount} eligibles)` +
      (undistributedEth > 0 ? `, ${undistributedEth.toFixed(4)} ETH rolled to buyback` : ""),
  );
  return { paid, failed, eligibleCount: draw.eligibleCount, undistributedEth };
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
