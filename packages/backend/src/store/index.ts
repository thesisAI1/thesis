/**
 * Persistence layer — behind a Store interface, so the local file-backed
 * implementation can be swapped for Postgres in production without touching
 * any agent code.
 */

import type {
  Chain,
  Distribution,
  Position,
  RegistryEntry,
  ReviewRecord,
  Submission,
} from "@thesis/shared";
import { config } from "../config.js";
import { FileStore } from "./fileStore.js";
import { PrismaStore } from "./prismaStore.js";

/** A profit share owed to an author who has not linked a wallet yet.
 *  Escrow is per (author, chain) — a Solana win owes SOL, a Base win owes ETH,
 *  and the two must never be summed into one figure. */
export interface EscrowEntry {
  xUserId: string;
  handle: string;
  amountEth: number;
  /** Chain the escrowed share is denominated/payable on (native units). */
  chain: Chain;
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
  /** Chain the payout is on — decides which wallet shape is valid in the reply
   *  and which chain adapter sends. Optional for back-compat with pre-Solana
   *  requests on disk (absent ⇒ base). */
  chain?: Chain;
}

/**
 * A write-ahead marker for a buy that has been (or is about to be) executed
 * on-chain but whose Position may not yet be persisted. Recorded BEFORE the
 * on-chain buy and cleared once the Position is saved (or the buy reverts). A
 * marker left behind on startup means a buy MAY have executed without a saved
 * position — the bot would never monitor those tokens (silent loss), so the
 * service logs it loudly for manual reconciliation.
 */
export interface PendingBuy {
  postId: string;
  contractAddress: string;
  amountInEth: number;
  at: string;
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
  /** Create or update the X-id -> wallet link (per chain — an author can have a
   *  Base wallet AND a Solana wallet). */
  linkWallet(entry: RegistryEntry): Promise<void>;
  /** Look up an author's payout wallet by numeric X id, for the given chain
   *  (defaults to base for back-compat with pre-Solana callers). */
  getRegistryEntry(xUserId: string, chain?: Chain): Promise<RegistryEntry | null>;

  /** Insert or update a position (keyed by id). */
  savePosition(position: Position): Promise<void>;
  /** All positions still open. */
  getOpenPositions(): Promise<Position[]>;
  /** Every position, open and closed. */
  getAllPositions(): Promise<Position[]>;
  /** Closed positions whose 25/25/25/25 settlement has NOT fully completed
   *  (no `settledAt`). The monitor retries these every tick until they settle. */
  getUnsettledClosedPositions(): Promise<Position[]>;

  /** Write-ahead a buy intent BEFORE the on-chain buy, so a crash before the
   *  Position is persisted is recoverable rather than a silent loss. */
  recordPendingBuy(buy: PendingBuy): Promise<void>;
  /** Open pending-buy markers. A non-empty list on startup means a buy may have
   *  executed without a saved position — needs manual reconciliation. */
  getPendingBuys(): Promise<PendingBuy[]>;
  /** Clear a post's pending marker once its Position is saved (or buy reverted). */
  clearPendingBuy(postId: string): Promise<void>;

  /** Record that a buy happened at `isoAt` on `chain` (for the per-chain rate
   *  limit). Defaults to base — Base and Solana have independent buy lanes. */
  recordBuy(isoAt: string, chain?: Chain): Promise<void>;
  /** How many buys happened on `chain` at or after `isoSince`. */
  countBuysSince(isoSince: string, chain?: Chain): Promise<number>;
  /** ISO timestamp of the most recent buy on `chain`, or null. */
  lastBuyAt(chain?: Chain): Promise<string | null>;

  /** Add to an unregistered author's escrowed profit share, per chain
   *  (defaults to base). Base keys by raw xUserId (unchanged); Solana is a
   *  separate per-chain entry so ETH and SOL escrow never mix. */
  addEscrow(xUserId: string, handle: string, amountEth: number, chain?: Chain): Promise<void>;
  getEscrow(xUserId: string, chain?: Chain): Promise<EscrowEntry | null>;
  /** Clear an author's escrow for a chain (e.g. after it has been paid out). */
  clearEscrow(xUserId: string, chain?: Chain): Promise<void>;
  /** Atomically clear an author's escrow AND their open payout requests for a
   *  chain in a single persist — used after a completed wallet payout so no
   *  half-cleared state can be re-processed by a later poll. */
  clearPayout(xUserId: string, chain?: Chain): Promise<void>;

  /** Record a posted "reply with your wallet" request, keyed by its tweet id. */
  addPayoutRequest(req: PayoutRequest): Promise<void>;
  /** Every open payout request. */
  getPayoutRequests(): Promise<PayoutRequest[]>;
  /** Drop payout requests belonging to an author (after they are paid). When
   *  `chain` is given, only that chain's requests are dropped. */
  clearPayoutRequestsForUser(xUserId: string, chain?: Chain): Promise<void>;

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

/** The process-wide store. The legacy JSON file store by default (the path the
 *  whole suite + production run against); set THESIS_STORE=sqlite to opt into
 *  the Prisma/SQLite store. Both implement the same interface. */
export function getStore(): Store {
  if (!singleton) {
    singleton =
      config.service.store === "sqlite"
        ? new PrismaStore(config.service.dataDir)
        : new FileStore(config.service.dataDir);
  }
  return singleton;
}
