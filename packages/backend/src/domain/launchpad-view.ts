import type { ReviewRecord } from "@thesis/shared";

/**
 * Build a launchpad-source lookup for the dashboard from the review log.
 *
 * The dashboard shows a per-token source badge ("clanker" / "bankr" /
 * "virtuals" / …). Launchpad isn't stored on a Position, so we recover it from
 * the ReviewRecord that opened it. Resolution order:
 *   1. The review LINKED to the position by id — the precise source.
 *   2. Else the most recent review of the SAME contract address. A token's
 *      launchpad is stable, so this safely covers positions whose review
 *      predates the launchpad field (backfilled null) or isn't id-linked.
 *   3. Else null (no badge).
 *
 * Reviews with a null launchpad are skipped so they never shadow a later review
 * that did capture the source.
 */
export function buildLaunchpadResolver(
  reviews: ReviewRecord[],
): (positionId: string, contractAddress: string) => string | null {
  const byPosition = new Map<string, string>();
  const byAddress = new Map<string, string>();
  for (const r of reviews) {
    if (!r.launchpad) continue;
    if (r.positionId) byPosition.set(r.positionId, r.launchpad);
    // reviews arrive oldest-first, so the last write wins = most recent source.
    byAddress.set(r.contractAddress.toLowerCase(), r.launchpad);
  }
  return (positionId, contractAddress) =>
    byPosition.get(positionId) ?? byAddress.get(contractAddress.toLowerCase()) ?? null;
}
