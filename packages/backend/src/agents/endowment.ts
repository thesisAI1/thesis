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

/** Split and pay out a position's total realised profit. Returns null if not in profit. */
export async function runEndowment(
  position: Position,
  profitEth: number,
): Promise<Distribution | null> {
  if (profitEth <= 0) return null;

  const quarter = profitEth / 4;
  const store = getStore();
  const chain = createChainAdapter();
  const entry = await store.getRegistryEntry(position.authorXId);

  // 25% — the author. Pay a known wallet directly, or escrow + ask on X.
  if (entry) {
    await payAuthorDirect(position, entry, quarter);
  } else {
    await store.addEscrow(position.authorXId, position.authorHandle, quarter);
    await requestAuthorPayout(position);
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
    positionId: position.id,
    totalProfitEth: profitEth,
    toAuthorEth: quarter,
    toPortfolioEth: quarter,
    toTeamEth: quarter,
    toBuybackEth: quarter,
    authorWallet: entry ? entry.wallet : null,
  };
}

/** Pay an author whose payout wallet is already on file, and confirm on X. */
async function payAuthorDirect(
  position: Position,
  entry: RegistryEntry,
  amountEth: number,
): Promise<void> {
  let txHash: string;
  try {
    txHash = await createChainAdapter().sendEth(entry.wallet, amountEth);
  } catch (err) {
    log.error(`endowment: author payout failed for ${entry.handle} — ${String(err)}`);
    return;
  }
  log.info(
    `endowment: paid author ${entry.handle} ${amountEth.toFixed(4)} ETH — tx ${txHash}`,
  );
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

/**
 * Escrowed an unregistered author's share — ask them, on their own thesis,
 * to reply with a Base wallet. One open request per author: any further
 * profit simply grows the escrow, paid out in full when they answer.
 */
async function requestAuthorPayout(position: Position): Promise<void> {
  const store = getStore();
  const escrow = await store.getEscrow(position.authorXId);
  const owed = escrow?.amountEth ?? 0;

  const open = await store.getPayoutRequests();
  if (open.some((r) => r.xUserId === position.authorXId)) {
    log.info(
      `endowment: ${position.authorHandle} already has an open payout request — ` +
        `escrow now ${owed.toFixed(4)} ETH`,
    );
    return;
  }

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
      `endowment: ${position.authorHandle} not registered — escrowed ${owed.toFixed(4)} ETH, ` +
        `posted payout request ${requestTweetId}`,
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
