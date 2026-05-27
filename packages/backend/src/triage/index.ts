/**
 * Triage — Step 1 of mention handling.
 *
 * Takes a raw batch of mentions and applies free, instant filters (no API
 * calls) to drop structural junk before anything expensive happens:
 *   - no contract address
 *   - author below the follower threshold
 *   - no real thesis text (just a bare contract)
 *   - the same contract reviewed/queued recently
 *   - the same author reviewed/queued recently (anti-spam cooldown)
 *
 * Survivors become QueueItems with a priority score (author reach +
 * engagement) and are handed to the service to enqueue.
 */

import type { Submission } from "@thesis/shared";
import type { XPost } from "../adapters/x/index.js";
import { config } from "../config.js";
import { getStore, type QueueItem } from "../store/index.js";
import { extractContract, guessChain } from "../util/contracts.js";

/** Why a mention failed Step-1 triage. Used by the service to decide whether
 *  to post an explanatory reply on X. Silent reasons (no CA, low follower
 *  count, blacklist hits) intentionally have no entry — we don't surface
 *  those publicly. */
export type TriageRejection =
  | { kind: "author_cooldown"; hoursLeft: number }
  | { kind: "contract_dedup"; hoursLeft: number }
  | { kind: "thesis_too_short"; words: number; minWords: number };

export interface TriageResult {
  /** Submissions that passed every Step 1 filter. */
  eligible: QueueItem[];
  /** Mentions that failed for a reason worth telling the author about. */
  rejected: Array<{ post: XPost; reason: TriageRejection }>;
  /** How many mentions were seen and how many passed. */
  seen: number;
  passed: number;
}

/** Run the Step 1 free filters over a batch of mentions. */
export async function triageMentions(posts: XPost[]): Promise<TriageResult> {
  const store = getStore();
  const reviews = await store.getReviews();
  const queued = await store.getQueue();
  const now = Date.now();

  const contractCutoff = now - config.triage.contractDedupHours * 3_600_000;
  const authorCutoff = now - config.triage.authorCooldownHours * 3_600_000;

  // Contracts / authors already reviewed (within window) or sitting in the queue.
  const seenContracts = new Set<string>();
  const seenAuthors = new Set<string>();
  // Earliest time (ms) we last saw a contract / author — used to estimate
  // when the cooldown will clear, so the rejection reply can say "try again
  // in Xh" rather than just "wait".
  const contractLastSeen = new Map<string, number>();
  const authorLastSeen = new Map<string, number>();
  for (const r of reviews) {
    const t = Date.parse(r.reviewedAt);
    if (t >= contractCutoff) {
      const key = r.contractAddress.toLowerCase();
      seenContracts.add(key);
      contractLastSeen.set(key, Math.max(contractLastSeen.get(key) ?? 0, t));
    }
    if (t >= authorCutoff) {
      seenAuthors.add(r.authorXId);
      authorLastSeen.set(r.authorXId, Math.max(authorLastSeen.get(r.authorXId) ?? 0, t));
    }
  }
  for (const q of queued) {
    const key = q.submission.contractAddress.toLowerCase();
    seenContracts.add(key);
    seenAuthors.add(q.submission.authorXId);
    contractLastSeen.set(key, now);
    authorLastSeen.set(q.submission.authorXId, now);
  }

  // Optional opt-in blacklist via SELF_BLACKLIST env var — addresses we don't
  // want reviewed at all. $THESIS is intentionally NOT here; submissions for
  // the committee's own token get a hardcoded A grade in the Dean and are
  // bought with treasury ETH (a reactive, user-driven buyback).
  const blacklist = new Set<string>(
    config.triage.selfBlacklist.map((a) => a.toLowerCase()),
  );

  const eligible: QueueItem[] = [];
  const rejected: Array<{ post: XPost; reason: TriageRejection }> = [];
  for (const post of posts) {
    if (await store.isProcessed(post.postId)) continue;
    await store.markProcessed(post.postId);

    const contract = extractContract(post.text);
    if (!contract) continue; // chatbot territory, not a thesis rejection
    if (blacklist.has(contract.toLowerCase())) continue;
    // Low follower count is intentionally silent — calling that out publicly
    // would be rude, and the threshold is a soft signal anyway.
    if (post.authorFollowers < config.triage.minAuthorFollowers) continue;
    const wordsInThesis = wordCount(thesisText(post.text, contract));
    if (wordsInThesis < config.triage.minThesisWords) {
      rejected.push({
        post,
        reason: {
          kind: "thesis_too_short",
          words: wordsInThesis,
          minWords: config.triage.minThesisWords,
        },
      });
      continue;
    }
    const contractKey = contract.toLowerCase();
    if (seenContracts.has(contractKey)) {
      const lastSeen = contractLastSeen.get(contractKey) ?? now;
      const hoursLeft = Math.max(
        0.1,
        config.triage.contractDedupHours - (now - lastSeen) / 3_600_000,
      );
      rejected.push({
        post,
        reason: { kind: "contract_dedup", hoursLeft },
      });
      continue;
    }
    if (seenAuthors.has(post.authorXId)) {
      const lastSeen = authorLastSeen.get(post.authorXId) ?? now;
      const hoursLeft = Math.max(
        0.1,
        config.triage.authorCooldownHours - (now - lastSeen) / 3_600_000,
      );
      rejected.push({
        post,
        reason: { kind: "author_cooldown", hoursLeft },
      });
      continue;
    }

    // Passed — dedupe later posts in this same batch too.
    seenContracts.add(contractKey);
    seenAuthors.add(post.authorXId);
    contractLastSeen.set(contractKey, now);
    authorLastSeen.set(post.authorXId, now);

    const submission: Submission = {
      postId: post.postId,
      authorXId: post.authorXId,
      authorHandle: post.authorHandle,
      thesisText: post.text,
      contractAddress: contract,
      chain: guessChain(contract),
      postUrl: post.url,
      postedAt: post.createdAt,
    };
    eligible.push({
      submission,
      priority: post.authorFollowers + post.engagement * 8,
      enqueuedAt: new Date().toISOString(),
    });
  }

  return { eligible, rejected, seen: posts.length, passed: eligible.length };
}

/** The thesis text — the post minus @mentions, the contract, URLs and "CA:". */
function thesisText(text: string, contract: string): string {
  return text
    .replace(contract, " ")
    .replace(/@\w+/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\bca:?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 1).length;
}
