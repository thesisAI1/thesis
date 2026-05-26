/**
 * Persistence layer — behind a Store interface, so the local file-backed
 * implementation can be swapped for Postgres in production without touching
 * any agent code.
 */

import type {
  Distribution,
  Position,
  RegistryEntry,
  ReviewRecord,
  Submission,
} from "@thesis/shared";
import { config } from "../config.js";
import { FileStore } from "./fileStore.js";

/** A profit share owed to an author who has not linked a wallet yet. */
export interface EscrowEntry {
  xUserId: string;
  handle: string;
  amountEth: number;
  updatedAt: string;
}

/**
 * A posted "reply with your payout wallet" request, awaiting an answer.
 *
 * Keyed by the id of the tweet the agent posted. A wallet reply is only
 * honoured when it is a reply to THIS exact tweet AND comes from `xUserId`
 * — so nobody but the original author can claim the payout.
 */
export interface PayoutRequest {
  /** The tweet the agent posted asking the author to reply with a wallet. */
  requestTweetId: string;
  /** Numeric X id of the original author — ONLY they may answer this. */
  xUserId: string;
  /** @handle at request time (display only). */
  handle: string;
  /** The original thesis post this payout traces back to. */
  threadPostId: string;
  requestedAt: string;
}

/** A submission waiting in the review queue, with its triage priority. */
export interface QueueItem {
  submission: Submission;
  /** Higher = reviewed sooner. Derived from author reach + post engagement. */
  priority: number;
  enqueuedAt: string;
}

/** Cumulative triage funnel counters. */
export interface Funnel {
  /** Mentions seen by the poller. */
  seen: number;
  /** Mentions that passed the Step 1 filters and were queued. */
  passed: number;
}

export interface Store {
  /** Create or update the X-id -> wallet link. */
  linkWallet(entry: RegistryEntry): Promise<void>;
  /** Look up an author's payout wallet by numeric X id. */
  getRegistryEntry(xUserId: string): Promise<RegistryEntry | null>;

  /** Insert or update a position (keyed by id). */
  savePosition(position: Position): Promise<void>;
  /** All positions still open. */
  getOpenPositions(): Promise<Position[]>;
  /** Every position, open and closed. */
  getAllPositions(): Promise<Position[]>;

  /** Record that a buy happened at `isoAt` (for the rate limit). */
  recordBuy(isoAt: string): Promise<void>;
  /** How many buys happened at or after `isoSince`. */
  countBuysSince(isoSince: string): Promise<number>;
  /** ISO timestamp of the most recent buy, or null. */
  lastBuyAt(): Promise<string | null>;

  /** Add to an unregistered author's escrowed profit share. */
  addEscrow(xUserId: string, handle: string, amountEth: number): Promise<void>;
  getEscrow(xUserId: string): Promise<EscrowEntry | null>;
  /** Clear an author's escrow (e.g. after it has been paid out). */
  clearEscrow(xUserId: string): Promise<void>;

  /** Record a posted "reply with your wallet" request, keyed by its tweet id. */
  addPayoutRequest(req: PayoutRequest): Promise<void>;
  /** Every open payout request. */
  getPayoutRequests(): Promise<PayoutRequest[]>;
  /** Drop every payout request belonging to an author (after they are paid). */
  clearPayoutRequestsForUser(xUserId: string): Promise<void>;

  /** Add a submission to the review queue. */
  enqueue(item: QueueItem): Promise<void>;
  /** The whole review queue, as stored. */
  getQueue(): Promise<QueueItem[]>;
  /** Remove and return the highest-priority queued submission, or null. */
  dequeueHighest(): Promise<QueueItem | null>;
  /** Drop queued submissions enqueued before `isoCutoff`; returns how many. */
  pruneQueue(isoCutoff: string): Promise<number>;

  /** Bump the triage funnel counters. */
  bumpFunnel(seen: number, passed: number): Promise<void>;
  /** The cumulative triage funnel. */
  getFunnel(): Promise<Funnel>;

  /** Submission dedup — has this X post already been reviewed? */
  isProcessed(postId: string): Promise<boolean>;
  markProcessed(postId: string): Promise<void>;

  /** Persist a Faculty review summary (one per reviewed submission). */
  saveReview(record: ReviewRecord): Promise<void>;
  /** Every review, oldest first. */
  getReviews(): Promise<ReviewRecord[]>;

  /** Persist a profit distribution (the 25/25/25/25 split of a winning trade). */
  saveDistribution(dist: Distribution): Promise<void>;
  /** Every distribution, oldest first. */
  getDistributions(): Promise<Distribution[]>;
}

let singleton: Store | null = null;

/** The process-wide store. File-backed locally; swap for Postgres in production. */
export function getStore(): Store {
  if (!singleton) singleton = new FileStore(config.service.dataDir);
  return singleton;
}
