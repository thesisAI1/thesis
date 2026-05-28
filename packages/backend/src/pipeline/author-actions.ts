/**
 * Author-triggered actions on their own open positions, dispatched from
 * X replies. Currently a single action: **manual close**.
 *
 * Flow (per mention seen by the poll loop):
 *   1. Reply must be in-thread of an OPEN position's original thesis tweet
 *      (`mention.inReplyToId === position.postId`)
 *   2. Reply must come from the ORIGINAL author of that position
 *      (`mention.authorXId === position.authorXId`) — same anti-hijack
 *      pattern as the payout-wallet flow
 *   3. Reply text must match a strict close-intent regex (no false positives
 *      from prose like "I might close this later")
 *   4. The author hasn't asked to close this position within the last 60s
 *      (anti-spam)
 *   5. Position is currently >= +20% in net profit (no loss-dumping; saves us
 *      from authors closing right before slippage to deny the standard SL)
 *
 * If all five pass, we hand off to monitor.closeByAuthor() — which runs the
 * exact same close pipeline as TP4 final / trailing-stop (sell, settle, card).
 * If the profit check fails, we reply with a friendly "needs ≥20%" note.
 * Everything else fails silently (don't draw attention to abuse vectors).
 */

import type { Position } from "@thesis/shared";
import { createBaseDataAdapter } from "../adapters/basedata/index.js";
import { createXAdapter, type XPost } from "../adapters/x/index.js";
import { closeByAuthor } from "../monitor/index.js";
import { getStore } from "../store/index.js";
import { log } from "../util/log.js";
import { manualCloseRejectText } from "../util/replies.js";

/** Anti-spam: max one close-request per author per 60s. In-memory only —
 *  resets on process restart, which is fine for a defensive guard. */
const lastCloseAttemptAt = new Map<string, number>();
const CLOSE_RATE_LIMIT_MS = 60_000;

/** Net-profit threshold for a manual close (20% above the initial cost). */
const MIN_PROFIT_MULTIPLE = 1.20;

/** Strict close-intent regex. Matches short, command-like replies — won't
 *  fire on prose ("we should close this thing eventually"). The text is
 *  trimmed of leading @mentions before matching. */
const CLOSE_INTENT_RE = /^(close|exit|sell|tp\s*now|dump)\s*(it|now|all|out)?\s*\.?$/i;

/**
 * Pull author-close requests out of a batch of mentions, act on the valid
 * ones, and return the mentions that should flow on to the rest of the
 * poll loop (chatbot, triage).
 */
export async function processAuthorCloseRequests(mentions: XPost[]): Promise<XPost[]> {
  const store = getStore();
  const openPositions = await store.getOpenPositions();
  if (openPositions.length === 0) return mentions;

  // Lookup: original thesis postId → position.
  const byPostId = new Map(openPositions.map((p) => [p.postId, p]));

  const passthrough: XPost[] = [];
  for (const mention of mentions) {
    if (!mention.inReplyToId) {
      passthrough.push(mention);
      continue;
    }
    const pos = byPostId.get(mention.inReplyToId);
    if (!pos) {
      passthrough.push(mention);
      continue;
    }
    // Anti-hijack — only the original author can ask to close.
    if (mention.authorXId !== pos.authorXId) {
      passthrough.push(mention);
      continue;
    }
    // Intent check — strict regex on trimmed text (drop leading @mentions).
    const cleaned = mention.text
      .replace(/^(?:\s*@\w+\s*)+/i, "")
      .trim();
    if (!CLOSE_INTENT_RE.test(cleaned)) {
      passthrough.push(mention);
      continue;
    }
    // Anti-spam — 60s per-author cooldown.
    const lastAt = lastCloseAttemptAt.get(mention.authorXId) ?? 0;
    if (Date.now() - lastAt < CLOSE_RATE_LIMIT_MS) {
      // Silent — author already pinged us recently for this same kind of action.
      continue;
    }
    lastCloseAttemptAt.set(mention.authorXId, Date.now());

    await handleCloseRequest(pos, mention);
    // Consumed — don't pass on to chatbot/triage.
  }

  return passthrough;
}

/** Validate the profit threshold + execute the close, replying on failure. */
async function handleCloseRequest(pos: Position, mention: XPost): Promise<void> {
  // Fetch current price. If we can't, treat as transient infra and silently
  // skip — the author can retry next poll.
  let currentPrice = pos.entryPriceEth;
  try {
    currentPrice = await createBaseDataAdapter().getPriceEth(pos.order.contractAddress);
  } catch (err) {
    log.warn(
      `author-close: price fetch failed for ${pos.id} (${mention.authorHandle}): ${String(err)}`,
    );
    return;
  }
  if (currentPrice <= 0) {
    log.warn(`author-close: price returned zero for ${pos.id}, skipping`);
    return;
  }

  // Compute "if we closed now, what's the net result vs initial cost?"
  const remainingTokens =
    pos.entryPriceEth > 0
      ? (pos.order.amountInEth * pos.remainingFraction) / pos.entryPriceEth
      : 0;
  const liveValueIfClosed = remainingTokens * currentPrice;
  const totalIfClosed = pos.realisedPnlEth + liveValueIfClosed;
  const required = pos.order.amountInEth * MIN_PROFIT_MULTIPLE;

  if (totalIfClosed < required) {
    const currentPct =
      pos.order.amountInEth > 0
        ? ((totalIfClosed - pos.order.amountInEth) / pos.order.amountInEth) * 100
        : 0;
    log.info(
      `author-close: rejected ${pos.id} (${mention.authorHandle}) — only +${currentPct.toFixed(1)}% (need ≥+20%)`,
    );
    try {
      const replyId = await createXAdapter().replyToPost(
        mention.postId,
        manualCloseRejectText(currentPct),
      );
      log.info(`x: replied to ${mention.postId} explaining rejected close (reply ${replyId})`);
    } catch (err) {
      log.warn(`x: rejected-close reply failed for ${mention.postId}: ${String(err)}`);
    }
    return;
  }

  // Approved — hand off to the monitor's close pipeline.
  log.info(
    `author-close: approved ${pos.id} (${mention.authorHandle}) — closing at current price`,
  );
  try {
    await closeByAuthor(pos, currentPrice);
  } catch (err) {
    log.warn(
      `author-close: close execution failed for ${pos.id}: ${String(err)}`,
    );
    // Best-effort apology reply so the author isn't left wondering.
    try {
      await createXAdapter().replyToPost(
        mention.postId,
        "Close attempt failed on-chain (likely a swap revert). Try again in a minute — the position is still open and being monitored.",
      );
    } catch {
      /* swallow */
    }
  }
}
