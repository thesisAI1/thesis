/**
 * THE REGISTRAR — vets the author.
 *
 * Checks the X account (smart-follower reach, bot likelihood) and the track
 * record (the contracts they posted before, and how those performed).
 * Produces an AuthorReport with a 0-100 score and a reasoning trail.
 */

import type { AuthorReport, Submission } from "@thesis/shared";
import { createFrontrunAdapter } from "../adapters/frontrun/index.js";

export async function runRegistrar(submission: Submission): Promise<AuthorReport> {
  const frontrun = createFrontrunAdapter();
  const profile = await frontrun.getProfile(submission.authorHandle);

  const callCount = profile.caHistory.length;
  const perfKnown = profile.caHistory.filter((c) => typeof c.performanceX === "number").length;
  const pastHitRate = hitRate(profile.caHistory.map((c) => c.performanceX));
  const flags: string[] = [];
  const reasoning: string[] = [];

  reasoning.push(`Pulling ${submission.authorHandle} from Frontrun's X index…`);
  reasoning.push(`Smart followers: ${profile.kolFollowerCount} KOL / insider accounts`);
  reasoning.push(
    callCount === 0
      ? "Track record: no past contract calls on file"
      : perfKnown > 0
        ? `Track record: ${callCount} past calls, ${Math.round(pastHitRate * 100)}% reached 2x`
        : `Track record: ${callCount} past calls on file (performance not measured)`,
  );

  // Smart-follower reach (0-35). Saturates at 50 KOL — most legitimate
  // accounts cluster well below that, so the scale rewards credibility early
  // instead of requiring a celebrity-tier following before it counts.
  const followerScore = (Math.min(profile.kolFollowerCount, 50) / 50) * 35;
  // Track record (0-35). With real performance data we weight hit-rate fully;
  // when performance is unknown (the live Frontrun cache endpoint doesn't
  // return it), having a posting history is itself a partial-credit signal.
  const trackScore =
    callCount === 0
      ? 0
      : perfKnown > 0
        ? pastHitRate * 35
        : Math.min(callCount, 10) * 2.5; // 0-25 for unverified posting history
  if (callCount === 0) flags.push("no posting history");
  else if (perfKnown > 0 && pastHitRate === 0) flags.push("no past call reached 2x");

  // Base 40 — launch-phase calibration: an unknown caller isn't automatically
  // discredited. The Dean still sees isLikelyBot + raw flags and can decide.
  let score = Math.round(40 + followerScore + trackScore);

  const isLikelyBot = profile.kolFollowerCount === 0 && callCount === 0;
  if (isLikelyBot) {
    flags.push("no smart followers and no history — possible bot");
    reasoning.push("No reach and no history — flagging this account as a likely bot");
    // No hard score cap during launch — the Dean uses isLikelyBot directly.
  }
  score = Math.max(0, Math.min(100, score));
  reasoning.push(`Verdict — Author Score ${score} / 100`);

  return {
    authorXId: submission.authorXId,
    score,
    isLikelyBot,
    accountAgeDays: 0, // TODO: from the X profile
    smartFollowerCount: profile.kolFollowerCount,
    pastContracts: profile.caHistory,
    pastHitRate,
    flags,
    reasoning,
  };
}

/** Share of past calls that did >= 2x. */
function hitRate(performances: Array<number | undefined>): number {
  const known = performances.filter((p): p is number => typeof p === "number");
  if (known.length === 0) return 0;
  return known.filter((p) => p >= 2).length / known.length;
}
