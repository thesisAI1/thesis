/**
 * Author payouts over X — the wallet-reply handler.
 *
 * When a winning trade closes and the author has no wallet on file, the
 * Endowment escrows their 25% and posts a reply asking them to send a Base
 * wallet address. The author claims the share by REPLYING to that exact
 * tweet with a 0x address.
 *
 * `processWalletReplies` runs on every poll, before triage. For each mention:
 *   - if it is a reply to one of our payout-request tweets, it is a wallet
 *     answer — it is validated, paid, and consumed (never seen by triage);
 *   - otherwise it is passed through as a normal mention.
 *
 * SECURITY — the payout cannot be hijacked. A wallet reply is honoured only
 * when BOTH hold:
 *   1. it replies to the specific payout-request tweet the agent posted, and
 *   2. it comes from the exact numeric X user id that posted the thesis.
 * A reply from anyone else — even with a matching @handle — is ignored.
 */

import { isAddress } from "viem";
import { createChainAdapter } from "../adapters/chain/index.js";
import { createXAdapter, type XPost } from "../adapters/x/index.js";
import { getStore, type PayoutRequest } from "../store/index.js";
import { log } from "../util/log.js";
import { payoutSentText } from "../util/replies.js";

/** A Base/EVM wallet address, isolated (word boundaries) so a 64-hex tx hash is
 *  not mis-matched. Global so we can detect an ambiguous multi-address reply. */
const ADDRESS_RE = /\b0x[a-fA-F0-9]{40}\b/g;

/**
 * Pull wallet-reply answers out of a batch of mentions, pay them, and return
 * the mentions that should still flow on to triage as theses.
 */
export async function processWalletReplies(mentions: XPost[]): Promise<XPost[]> {
  const store = getStore();
  const requests = await store.getPayoutRequests();
  if (requests.length === 0) return mentions;

  const byTweetId = new Map(requests.map((r) => [r.requestTweetId, r]));
  const passthrough: XPost[] = [];

  for (const post of mentions) {
    const req = post.inReplyToId ? byTweetId.get(post.inReplyToId) : undefined;
    if (!req) {
      passthrough.push(post);
      continue;
    }
    await handleWalletReply(post, req);
    // Mark the wallet-reply tweet as processed so subsequent polls do NOT
    // re-feed it into triage. Without this the cleared payout request no
    // longer matches in byTweetId, the post falls through, triage's
    // extractContract picks the 0x wallet address as if it were a token CA,
    // strips it from the text leaving 0 words of analysis, and ships a
    // "thesis too short" reply on a tweet that was just a wallet answer.
    await store.markProcessed(post.postId);
  }
  return passthrough;
}

/** Validate one reply against its payout request and, if it checks out, pay. */
async function handleWalletReply(post: XPost, req: PayoutRequest): Promise<void> {
  const store = getStore();

  // (2) Only the original author may answer — match the numeric X id, not the
  // handle. Anyone else replying to the request tweet is ignored outright.
  if (post.authorXId !== req.xUserId) {
    log.warn(
      `payout: ignored wallet reply on ${req.requestTweetId} from ${post.authorHandle} ` +
        `(id ${post.authorXId}) — not the original author (${req.handle}, id ${req.xUserId})`,
    );
    return;
  }

  // Extract the payout wallet. We send real, irreversible ETH, so reject the
  // two ways a reply can be wrong rather than guessing:
  //   - MORE THAN ONE distinct address ("not 0xWRONG, I mean 0xRIGHT") → don't
  //     guess which to pay; wait for an unambiguous reply.
  //   - a malformed / bad-EIP-55-checksum address → reject. isAddress accepts
  //     all-lowercase and a valid checksum, but rejects a mistyped mixed-case
  //     address — catching a fat-fingered char before ETH leaves the wallet.
  const found = post.text.match(ADDRESS_RE) ?? [];
  const distinct = [...new Set(found.map((a) => a.toLowerCase()))];
  if (distinct.length > 1) {
    log.warn(
      `payout: reply from ${req.handle} on ${req.requestTweetId} had ${distinct.length} ` +
        `distinct addresses — ignoring (won't guess which to pay)`,
    );
    return;
  }
  const wallet = found[0];
  if (!wallet) {
    log.info(
      `payout: reply from ${req.handle} on ${req.requestTweetId} had no 0x address — waiting`,
    );
    return;
  }
  if (!isAddress(wallet)) {
    log.warn(
      `payout: reply from ${req.handle} on ${req.requestTweetId} had an invalid address ` +
        `(${wallet}) — failed EIP-55 checksum, ignoring`,
    );
    return;
  }

  const escrow = await store.getEscrow(req.xUserId);
  const owed = escrow?.amountEth ?? 0;
  if (owed <= 0) {
    log.warn(`payout: ${req.handle} answered but the escrow is empty — clearing the request`);
    await store.clearPayoutRequestsForUser(req.xUserId);
    return;
  }

  // Remember the wallet so any future win pays this author directly.
  await store.linkWallet({
    xUserId: req.xUserId,
    handle: req.handle,
    wallet,
    linkedAt: new Date().toISOString(),
  });

  let txHash: string;
  try {
    txHash = await createChainAdapter().sendEth(wallet, owed);
  } catch (err) {
    // Keep the escrow and the request so the payout can be retried next poll.
    log.error(`payout: send to ${req.handle} failed — ${String(err)}`);
    return;
  }

  // Atomically clear the escrow AND the open requests in a single write, so a
  // re-poll cannot re-pay (no half-cleared state). The only residual — a crash
  // between the confirmed on-chain send above and this write — is the same
  // accepted at-least-once window the settlement path documents; the escrow-
  // empty guard at the top of this function neutralises a same-batch re-reply.
  await store.clearPayout(req.xUserId);
  log.info(
    `payout: paid ${req.handle} ${owed.toFixed(4)} ETH to ${wallet} — tx ${txHash}`,
  );

  // Confirm on-chain delivery as a reply in the same thread.
  try {
    const replyId = await createXAdapter().replyToPost(
      post.postId,
      payoutSentText({ handle: req.handle, amountEth: owed, wallet, txHash }),
    );
    log.info(`x: replied to ${post.postId} confirming the payout (reply ${replyId})`);
  } catch (err) {
    log.warn(`x: payout confirmation reply failed for ${post.postId}: ${String(err)}`);
  }
}
