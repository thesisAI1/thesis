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
import bs58 from "bs58";
import type { Chain } from "@thesis/shared";
import { createChainAdapter } from "../adapters/chain/index.js";
import { createXAdapter, type XPost } from "../adapters/x/index.js";
import { publishOps } from "../observability/opsBus.js";
import { getStore, type PayoutRequest } from "../store/index.js";
import { log, logEvent } from "../util/log.js";
import { nativeSymbol } from "../util/chains.js";
import { payoutSentText } from "../util/replies.js";

/** EVM wallet, isolated (word boundaries) so a 64-hex tx hash is not matched. */
const EVM_ADDRESS_RE = /\b0x[a-fA-F0-9]{40}\b/g;
/** Solana base58 wallet — 32–44 base58 chars (no 0 O I l). */
const SOLANA_ADDRESS_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

/** A base58 string decodes to exactly 32 bytes for a valid Solana pubkey. */
function isSolanaAddress(addr: string): boolean {
  try {
    return bs58.decode(addr).length === 32;
  } catch {
    return false;
  }
}

/**
 * Extract + validate the payout wallet from a reply, for the request's chain.
 * Returns the wallet, or a reason string explaining why nothing was paid.
 * Money-safety: reject ambiguous (multiple distinct addresses) or wrong-shape
 * replies rather than guessing — real, irreversible funds move on success.
 */
function extractWallet(
  text: string,
  chain: Chain,
): { wallet: string } | { reject: string } {
  if (chain === "solana") {
    // base58 is case-sensitive — do NOT lowercase when de-duping.
    const found = (text.match(SOLANA_ADDRESS_RE) ?? []).filter(isSolanaAddress);
    const distinct = [...new Set(found)];
    if (distinct.length > 1) return { reject: `${distinct.length} distinct Solana addresses` };
    if (!distinct[0]) return { reject: "no valid base58 Solana address" };
    return { wallet: distinct[0] };
  }
  const found = text.match(EVM_ADDRESS_RE) ?? [];
  const distinct = [...new Set(found.map((a) => a.toLowerCase()))];
  if (distinct.length > 1) return { reject: `${distinct.length} distinct addresses` };
  const wallet = found[0];
  if (!wallet) return { reject: "no 0x address" };
  if (!isAddress(wallet)) return { reject: "invalid address (failed EIP-55 checksum)" };
  return { wallet };
}

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

  // Extract + validate the payout wallet for THIS request's chain (0x on Base,
  // base58 on Solana). Wrong-shape / ambiguous replies are rejected, never guessed.
  const chain: Chain = req.chain ?? "base";
  const sym = nativeSymbol(chain);
  const extracted = extractWallet(post.text, chain);
  if ("reject" in extracted) {
    log.info(
      `payout: reply from ${req.handle} on ${req.requestTweetId} not actionable for ${chain} ` +
        `(${extracted.reject}) — waiting`,
    );
    return;
  }
  const wallet = extracted.wallet;

  const escrow = await store.getEscrow(req.xUserId, chain);
  const owed = escrow?.amountEth ?? 0;
  if (owed <= 0) {
    log.warn(`payout: ${req.handle} answered but the ${chain} escrow is empty — clearing the request`);
    await store.clearPayoutRequestsForUser(req.xUserId, chain);
    return;
  }

  // Remember the wallet (per chain) so any future win pays this author directly.
  await store.linkWallet({
    xUserId: req.xUserId,
    handle: req.handle,
    wallet,
    chain,
    linkedAt: new Date().toISOString(),
  });

  let txHash: string;
  try {
    txHash = await createChainAdapter(chain).sendEth(wallet, owed);
  } catch (err) {
    // Keep the escrow and the request so the payout can be retried next poll.
    log.error(`payout: send to ${req.handle} failed — ${String(err)}`);
    logEvent({ level: "error", area: "payout", type: "payout:failed", msg: `payout: send to ${req.handle} failed — ${String(err)}`, ops: { type: "payout:failed", at: new Date().toISOString(), handle: req.handle, amountEth: owed, reason: String(err) } });
    return;
  }

  // Atomically clear the escrow AND the open requests for this chain in a single
  // write, so a re-poll cannot re-pay (no half-cleared state). The only residual
  // — a crash between the confirmed on-chain send above and this write — is the
  // same accepted at-least-once window the settlement path documents; the escrow-
  // empty guard at the top of this function neutralises a same-batch re-reply.
  await store.clearPayout(req.xUserId, chain);
  log.info(
    `payout: paid ${req.handle} ${owed.toFixed(4)} ${sym} to ${wallet} — tx ${txHash}`,
  );
  publishOps({ type: "payout:sent", at: new Date().toISOString(), path: "escrow", handle: req.handle, amountEth: owed, wallet, txHash });

  // Confirm on-chain delivery as a reply in the same thread.
  try {
    const replyId = await createXAdapter().replyToPost(
      post.postId,
      payoutSentText({ handle: req.handle, amountEth: owed, wallet, txHash, chain }),
    );
    log.info(`x: replied to ${post.postId} confirming the payout (reply ${replyId})`);
    publishOps({ type: "tweet:posted", at: new Date().toISOString(), kind: "payout-confirm", replyId, postId: post.postId });
  } catch (err) {
    log.warn(`x: payout confirmation reply failed for ${post.postId}: ${String(err)}`);
    logEvent({ level: "warn", area: "payout", type: "confirm-reply:failed", msg: `x: payout confirmation reply failed for ${post.postId}: ${String(err)}` });
  }
}
