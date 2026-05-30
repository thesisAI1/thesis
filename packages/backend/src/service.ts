/**
 * The service loops.
 *
 *   poll    -> fetch mentions, run Step 1 triage, enqueue the survivors
 *   review  -> drain the queue by priority, at the hourly budget, with TTL
 *   monitor -> (./monitor) watch open positions for TP / SL
 */

import type { Submission } from "@thesis/shared";
import { createXAdapter } from "./adapters/x/index.js";
import { config, useMock } from "./config.js";
import { runMonitorTick } from "./monitor/index.js";
import { processWalletReplies } from "./payout/index.js";
import { processAuthorCloseRequests } from "./pipeline/author-actions.js";
import { processChatbotReplies } from "./agents/chatbot.js";
import { reviewSubmission, type ReviewResult } from "./pipeline/index.js";
import { recordActivity } from "./activity.js";
import { getStore } from "./store/index.js";
import { triageMentions } from "./triage/index.js";
import { nativeSymbol } from "./util/chains.js";
import { log, logEvent } from "./util/log.js";
import { publishOps } from "./observability/opsBus.js";
import { markTick, checkLiveness } from "./observability/watchdog.js";
import { startNotifier } from "./adapters/telegram/notifier.js";
import { startBot } from "./adapters/telegram/bot.js";
import {
  buyReplyText,
  classifySkipReason,
  skipReplyText,
  triageRejectReplyText,
} from "./util/replies.js";

let lastSeenId: string | undefined;

/** One poll cycle: fetch mentions, triage them, enqueue the survivors. */
export async function pollCycle(): Promise<void> {
  const store = getStore();

  let mentions;
  try {
    mentions = await createXAdapter().pollMentions(lastSeenId);
  } catch (err) {
    log.warn(`poll: X mention fetch failed: ${String(err)}`);
    logEvent({ level: "warn", area: "service", type: "mention-fetch:failed", msg: `poll: X mention fetch failed: ${String(err)}` });
    return;
  }
  for (const post of mentions) lastSeenId = newerId(lastSeenId, post.postId);

  // Intercept author wallet replies (payouts) before triage — they are not
  // theses. Whatever is left flows on to the Step 1 triage filters.
  const afterWallet = await processWalletReplies(mentions);

  // Intercept author manual-close requests next (replies like "@thesis_agent
  // close" in-thread of their own open position). Consumed if valid, so they
  // don't accidentally feed the chatbot or triage.
  const afterCloseRequests = await processAuthorCloseRequests(afterWallet);

  // Chatbot answers non-thesis mentions (questions about the project) BEFORE
  // triage runs, so it can see posts that triage will later filter out for
  // having no contract address.
  await processChatbotReplies(afterCloseRequests);

  const triage = await triageMentions(afterCloseRequests);
  for (const item of triage.eligible) await store.enqueue(item);
  await store.bumpFunnel(triage.seen, triage.passed);
  await replyToTriageRejects(triage.rejected);

  const depth = (await store.getQueue()).length;
  log.info(
    `poll: ${triage.seen} mention(s), ${triage.passed} passed triage, queue depth ${depth}`,
  );
}

/** Per-author rate limit on triage rejection replies — one reply per author
 *  per 24h. Prevents spam loops where a serial submitter keeps tagging us. */
const triageReplyCooldown = new Map<string, number>();
const TRIAGE_REPLY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

async function replyToTriageRejects(
  rejected: Array<{ post: { postId: string; authorXId: string; authorHandle: string }; reason: Parameters<typeof triageRejectReplyText>[0] }>,
): Promise<void> {
  const now = Date.now();
  for (const { post, reason } of rejected) {
    const last = triageReplyCooldown.get(post.authorXId) ?? 0;
    if (now - last < TRIAGE_REPLY_COOLDOWN_MS) continue;
    const text = triageRejectReplyText(reason);
    try {
      const replyId = await createXAdapter().replyToPost(post.postId, text);
      log.info(
        `x: replied to ${post.postId} (${post.authorHandle}) — triage reject (${reason.kind}, reply ${replyId})`,
      );
      triageReplyCooldown.set(post.authorXId, now);
    } catch (err) {
      log.warn(`x: triage reject reply failed for ${post.postId}: ${String(err)}`);
      logEvent({ level: "warn", area: "service", type: "triage-reply:failed", msg: `x: triage reject reply failed for ${post.postId}: ${String(err)}` });
    }
  }
}

/** One review-loop tick: prune stale items, respect the budget, review one. */
export async function reviewTick(): Promise<void> {
  const store = getStore();

  const cutoff = new Date(Date.now() - config.triage.queueTtlMin * 60_000).toISOString();
  const expired = await store.pruneQueue(cutoff);
  if (expired > 0) {
    log.info(`triage: ${expired} stale submission(s) expired from the queue`);
  }

  // Hourly review budget — skipped in mock so the local demo stays lively.
  if (!useMock()) {
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const reviewedLastHour = (await store.getReviews()).filter(
      (r) => r.reviewedAt >= since,
    ).length;
    if (reviewedLastHour >= config.triage.reviewBudgetPerHour) return;
  }

  const item = await store.dequeueHighest();
  if (item) await processSubmission(item.submission);
}

/** Review one submission, persist it, and reply on X if it was funded. */
async function processSubmission(submission: Submission): Promise<void> {
  const store = getStore();
  try {
    const result = await reviewSubmission(submission);
    const v = result.verdict;
    await store.saveReview({
      reviewedAt: new Date().toISOString(),
      postId: submission.postId,
      postUrl: submission.postUrl,
      authorXId: submission.authorXId,
      authorHandle: submission.authorHandle,
      contractAddress: submission.contractAddress,
      chain: submission.chain,
      authorScore: v.authorReport.score,
      tokenScore: v.tokenReport.score,
      launchpad: v.tokenReport.launchpad,
      grade: v.grade,
      decision: v.decision,
      confidence: v.confidence,
      rationale: v.rationale,
      positionId: result.position?.id,
      skippedReason: result.skippedReason,
    });
    log.info(
      `review: ${submission.authorHandle} -> grade ${v.grade} ${v.decision} ` +
        `(author ${v.authorReport.score}/100, token ${v.tokenReport.score}/100)`,
    );

    if (result.position) {
      log.info(
        `bursar: opened ${result.position.id} — ` +
          `${result.position.order.amountInEth.toFixed(4)} ETH ` +
          `(${(v.positionSizePct * 100).toFixed(1)}% of portfolio)`,
      );
      // Feed the dashboard ticker tape: every fresh buy is "live activity".
      recordActivity({
        kind: "buy",
        summary: `${submission.authorHandle} funded — ${result.position.order.amountInEth.toFixed(4)} Ξ`,
        authorHandle: submission.authorHandle,
        positionId: result.position.id,
        amountEth: result.position.order.amountInEth,
      });
      publishOps({ type: "trade:buy", at: new Date().toISOString(), positionId: result.position.id, handle: submission.authorHandle, amountEth: result.position.order.amountInEth, contract: result.position.order.contractAddress });
      await replyOnBuy(submission, result);
    } else if (result.skippedReason) {
      log.info(`bursar: no buy — ${result.skippedReason}`);
      await replyOnSkip(submission, result);
    } else if (v.decision === "SKIP") {
      await replyOnSkip(submission, result);
    }
  } catch (err) {
    log.error(`review failed for ${submission.postId}: ${String(err)}`);
    logEvent({ level: "error", area: "service", type: "review:failed", msg: `review failed for ${submission.postId}: ${String(err)}` });
  }
}

/** Reply to the original X post announcing the buy. */
async function replyOnBuy(submission: Submission, result: ReviewResult): Promise<void> {
  if (!result.position) return;
  const text = buyReplyText({
    grade: result.verdict.grade,
    amountEth: result.position.order.amountInEth,
    marketCapUsd: result.verdict.tokenReport.marketCapUsd,
    takeProfits: config.trading.takeProfitTiers,
    stopLossPct: config.trading.stopLossPct,
    txHash: result.position.entryTxHash,
  });
  try {
    const replyId = await createXAdapter().replyToPost(submission.postId, text);
    log.info(`x: replied to ${submission.postId} announcing the buy (reply ${replyId})`);
    publishOps({ type: "tweet:posted", at: new Date().toISOString(), kind: "buy", replyId, postId: submission.postId });
  } catch (err) {
    log.warn(`x: buy reply failed for ${submission.postId}: ${String(err)}`);
    logEvent({ level: "warn", area: "service", type: "buy-reply:failed", msg: `x: buy reply failed for ${submission.postId}: ${String(err)}` });
  }
}

/** Reply to the original X post when the committee passed on the thesis.
 *  Two cases: Dean graded too low, or the Bursar held off (cooldown / daily limit).
 *  Internal skip reasons (empty portfolio, etc.) stay silent. */
async function replyOnSkip(submission: Submission, result: ReviewResult): Promise<void> {
  let text: string | null = null;
  if (result.verdict.decision === "SKIP") {
    text = skipReplyText({
      kind: "low-grade",
      grade: result.verdict.grade,
      minGrade: config.trading.minBuyGrade,
      auditorFlags: result.verdict.tokenReport.flags,
    });
  } else if (result.skippedReason) {
    const parsed = classifySkipReason(result.skippedReason);
    if (parsed) text = skipReplyText(parsed);
  }
  if (!text) return;
  try {
    const replyId = await createXAdapter().replyToPost(submission.postId, text);
    log.info(`x: replied to ${submission.postId} explaining the skip (reply ${replyId})`);
    publishOps({ type: "tweet:posted", at: new Date().toISOString(), kind: "skip", replyId, postId: submission.postId });
  } catch (err) {
    log.warn(`x: skip reply failed for ${submission.postId}: ${String(err)}`);
    logEvent({ level: "warn", area: "service", type: "skip-reply:failed", msg: `x: skip reply failed for ${submission.postId}: ${String(err)}` });
  }
}

/** Demo path — poll, review the whole queue, drain positions. Used by `npm run demo`. */
export async function runOnce(): Promise<void> {
  const store = getStore();
  for (let i = 0; i < 2; i++) await pollCycle();
  for (let i = 0; i < 12; i++) {
    const item = await store.dequeueHighest();
    if (!item) break;
    await processSubmission(item.submission);
  }
  for (let i = 0; i < 20; i++) {
    if ((await store.getOpenPositions()).length === 0) break;
    await runMonitorTick();
  }
  // Drain author payouts: poll again so the (mock) authors answer the payout
  // requests the Endowment posted while their winning trades were closing.
  for (let i = 0; i < 3; i++) await pollCycle();
}

/**
 * F1 startup reconcile — a pending-buy marker that survived to startup means a
 * buy was initiated but its Position was never persisted (a crash mid-buy). We
 * MAY be holding tokens with no monitored position (silent loss), so log each
 * one loudly for manual recovery. We do NOT auto-clear: the alert should persist
 * across restarts until the operator reconciles against the on-chain balance.
 */
async function reconcilePendingBuys(): Promise<void> {
  try {
    const orphans = await getStore().getPendingBuys();
    for (const b of orphans) {
      log.error(
        `bursar: ORPHANED BUY — ${b.amountInEth} ${nativeSymbol(b.chain ?? "base")} for ${b.contractAddress} (post ${b.postId}, ` +
          `recorded ${b.at}) has NO saved position. The buy MAY have executed on-chain and the bot ` +
          `is NOT monitoring those tokens. Check the wallet balance for that token, then recover via ` +
          `/admin/rebuy-position or open a position manually.`,
      );
    }
  } catch (err) {
    log.warn(`service: pending-buy reconcile failed — ${String(err)}`);
  }
}

/** Start the continuous service loops. Returns a stop() handle. */
export function startService(): () => void {
  let stopped = false;
  // F1 — surface any buy initiated without a saved position (a crash mid-buy).
  void reconcilePendingBuys();
  // Mock mode polls fast for a lively local demo; live mode uses the config.
  const pollMs = useMock() ? 25_000 : config.service.pollIntervalSec * 1000;
  const reviewMs = config.service.reviewIntervalSec * 1000;
  const monitorMs = config.service.monitorIntervalSec * 1000;

  // Self-rescheduling loop: the next tick is scheduled only AFTER the current
  // one settles, so a slow tick can never overlap itself. (A bare setInterval
  // fires on a fixed clock regardless of whether the previous tick finished —
  // that overlap is what let two monitor ticks double-settle a position.)
  const loop = (label: string, fn: () => Promise<void>, intervalMs: number): void => {
    const tick = async (): Promise<void> => {
      if (stopped) return;
      try {
        await fn();
      } catch (err) {
        log.error(`${label} loop: ${String(err)}`);
        logEvent({ level: "error", area: "service", type: `${label}-loop:failed`, msg: `${label} loop: ${String(err)}` });
      }
      // Heartbeat off the poll loop (the watchdog's stale threshold derives from
      // the poll interval); stamped AFTER the tick so a hung poll stops ticking it.
      if (label === "poll") markTick();
      if (!stopped) setTimeout(() => void tick(), intervalMs);
    };
    void tick();
  };

  loop("poll", pollCycle, pollMs);
  loop("review", reviewTick, reviewMs);
  loop("monitor", runMonitorTick, monitorMs);

  const stopNotifier = startNotifier();
  const stopBot = startBot();
  const liveness = setInterval(() => checkLiveness(), 30_000);

  log.info(
    `service: poll ${Math.round(pollMs / 1000)}s · review ${config.service.reviewIntervalSec}s · ` +
      `monitor ${config.service.monitorIntervalSec}s`,
  );
  return () => {
    stopped = true;
    clearInterval(liveness);
    stopNotifier();
    stopBot();
  };
}

/** Pick the newer of two post ids (numeric X ids, lexical fallback for mocks). */
function newerId(current: string | undefined, candidate: string): string {
  if (!current) return candidate;
  if (/^\d+$/.test(current) && /^\d+$/.test(candidate)) {
    return BigInt(candidate) > BigInt(current) ? candidate : current;
  }
  return candidate;
}
