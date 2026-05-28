/**
 * The submission pipeline — wires the five agents together and streams their
 * work live.
 *
 *   Submission
 *      -> Registrar + Auditor   (run in parallel)
 *      -> Dean                  (verdict: grade + BUY/SKIP)
 *      -> Bursar                (opens a position, if BUY and not rate-limited)
 *
 * Each agent's reasoning is published to the event bus, paced so the website
 * can show the committee deliberating step by step. Exits are settled
 * separately by the monitor via settlePosition().
 */

import type { Position, Submission, Verdict } from "@thesis/shared";
import { runRegistrar } from "../agents/registrar.js";
import { runAuditor } from "../agents/auditor.js";
import { runDean } from "../agents/dean.js";
import { runBursar } from "../agents/bursar.js";
import { runEndowment, type EndowmentResult } from "../agents/endowment.js";
import { publish } from "../events.js";

export interface ReviewResult {
  verdict: Verdict;
  position: Position | null;
  /** Set when the Dean approved but the Bursar declined to buy. */
  skippedReason?: string;
}

/** Delay between streamed reasoning steps — paces the live view. Set
 *  STREAM_STEP_MS=0 to disable pacing (used by the demo run). */
const STEP_MS = Number(process.env.STREAM_STEP_MS ?? 280);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Publish one agent's reasoning, step by step. */
async function streamAgent(agent: string, steps: string[]): Promise<void> {
  publish({ type: "agent:active", agent });
  for (const text of steps) {
    await sleep(STEP_MS);
    publish({ type: "agent:step", agent, text });
  }
  await sleep(STEP_MS);
  publish({ type: "agent:done", agent });
}

/** Run a submission through review and (if approved) execution. */
export async function reviewSubmission(submission: Submission): Promise<ReviewResult> {
  publish({
    type: "review:start",
    submission: {
      postId: submission.postId,
      authorHandle: submission.authorHandle,
      contractAddress: submission.contractAddress,
      thesisText: submission.thesisText,
      postUrl: submission.postUrl,
    },
  });

  const [authorReport, tokenReport] = await Promise.all([
    runRegistrar(submission),
    runAuditor(submission),
  ]);
  await streamAgent("registrar", authorReport.reasoning);
  await streamAgent("auditor", tokenReport.reasoning);

  const verdict = await runDean(submission, authorReport, tokenReport);
  await streamAgent("dean", verdict.reasoning);
  publish({
    type: "review:verdict",
    grade: verdict.grade,
    decision: verdict.decision,
    confidence: verdict.confidence,
    positionSizePct: verdict.positionSizePct,
    authorScore: authorReport.score,
    tokenScore: tokenReport.score,
  });

  const bursar = await runBursar(verdict);
  await streamAgent(
    "bursar",
    bursar.position
      ? [
          `Sizing the position at ${(verdict.positionSizePct * 100).toFixed(1)}% of the portfolio`,
          `Buying ${bursar.position.order.amountInEth.toFixed(4)} ETH of the token on Base`,
          "Take-profit +100% and stop-loss -35% attached to the position",
          `Position ${bursar.position.id} is now open`,
        ]
      : verdict.decision === "SKIP"
        ? ["No position taken — the Dean graded this submission a SKIP"]
        : [`The Dean approved — but holding off: ${bursar.skippedReason ?? "skipped"}`],
  );

  publish({ type: "review:end" });
  return { verdict, position: bursar.position, skippedReason: bursar.skippedReason };
}

/** Settle one realised profit tranche — split it 25/25/25/25. The monitor
 *  passes `silentAuthorTweet: true` so the author payment line lands in the
 *  combined close-announcement tweet instead of a separate reply. */
export async function settlePosition(
  position: Position,
  profitEth: number,
): Promise<EndowmentResult | null> {
  return runEndowment(position, profitEth, { silentAuthorTweet: true });
}
