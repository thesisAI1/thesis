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

export interface TriageResult {
  /** Submissions that passed every Step 1 filter. */
  eligible: QueueItem[];
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
  for (const r of reviews) {
    if (Date.parse(r.reviewedAt) >= contractCutoff) {
      seenContracts.add(r.contractAddress.toLowerCase());
    }
    if (Date.parse(r.reviewedAt) >= authorCutoff) seenAuthors.add(r.authorXId);
  }
  for (const q of queued) {
    seenContracts.add(q.submission.contractAddress.toLowerCase());
    seenAuthors.add(q.submission.authorXId);
  }

  // Optional opt-in blacklist via SELF_BLACKLIST env var — addresses we don't
  // want reviewed at all. $THESIS is intentionally NOT here; submissions for
  // the committee's own token get a hardcoded A grade in the Dean and are
  // bought with treasury ETH (a reactive, user-driven buyback).
  const blacklist = new Set<string>(
    config.triage.selfBlacklist.map((a) => a.toLowerCase()),
  );

  const eligible: QueueItem[] = [];
  for (const post of posts) {
    if (await store.isProcessed(post.postId)) continue;
    await store.markProcessed(post.postId);

    const contract = extractContract(post.text);
    if (!contract) continue;
    if (blacklist.has(contract.toLowerCase())) continue;
    if (post.authorFollowers < config.triage.minAuthorFollowers) continue;
    if (wordCount(thesisText(post.text, contract)) < config.triage.minThesisWords) {
      continue;
    }
    if (seenContracts.has(contract.toLowerCase())) continue;
    if (seenAuthors.has(post.authorXId)) continue;

    // Passed — dedupe later posts in this same batch too.
    seenContracts.add(contract.toLowerCase());
    seenAuthors.add(post.authorXId);

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

  return { eligible, seen: posts.length, passed: eligible.length };
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
