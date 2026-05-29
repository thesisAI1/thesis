/**
 * A SQLite/Prisma-backed Store — a behaviour-identical drop-in for FileStore.
 *
 * Every method reproduces the file store's semantics EXACTLY (see fileStore.ts),
 * because this is money-handling persistence. The two places that need care:
 *
 *   - Optional-field parity. FileStore round-trips through JSON, so a field that
 *     was never set comes back as `undefined`. SQLite gives us `null`. The
 *     rowTo* mappers convert null -> undefined for every OPTIONAL field, so a
 *     read-back deep-equals what FileStore would return. (Distribution.authorWallet
 *     is `string | null`, NOT optional — its null is preserved as null.)
 *   - Nested objects (Position.order, QueueItem.submission) are stored as Json
 *     and reconstructed into their exact @thesis/shared shape.
 *
 * Ordering invariants mirrored from FileStore:
 *   - reviews / distributions: oldest-first (autoincrement id ASC).
 *   - dequeueHighest: highest priority, first-enqueued on ties (id ASC tiebreak).
 *   - markProcessed: idempotent, with the dedup log capped at the last 5000.
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import type {
  Distribution,
  Position,
  RegistryEntry,
  ReviewRecord,
  Submission,
  TradeOrder,
} from "@thesis/shared";
import type { EscrowEntry, Funnel, PayoutRequest, QueueItem, Store } from "./index.js";

/** The fixed primary key of the single funnel-counters row. */
const FUNNEL_ID = 1;
/** Keep the dedup log bounded — same cap FileStore enforces. */
const PROCESSED_CAP = 5000;

/** null -> undefined, leaving every other value untouched. Used so optional
 *  fields read back as `undefined` (FileStore's JSON behaviour), not `null`. */
function undef<T>(v: T | null): T | undefined {
  return v === null ? undefined : v;
}

export class PrismaStore implements Store {
  private readonly prisma: PrismaClient;

  constructor(dataDir: string) {
    const dir = resolve(dataDir);
    mkdirSync(dir, { recursive: true });
    // DATA_DIR is the single source of truth for where data lives at runtime,
    // regardless of how the schema's DATABASE_URL resolves at generate time.
    const dbPath = resolve(dir, "thesis.db");
    this.prisma = new PrismaClient({
      datasources: { db: { url: `file:${dbPath}` } },
    });
  }

  /** Close the underlying client. Not part of the Store interface, but the
   *  tests need a clean teardown between cases. */
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  // ---- mappers -------------------------------------------------------------

  private rowToPosition(row: {
    id: string;
    postId: string;
    authorXId: string;
    authorHandle: string;
    authorAvatarUrl: string | null;
    postUrl: string | null;
    order: Prisma.JsonValue;
    status: string;
    entryPriceEth: number;
    marketCapAtEntryUsd: number | null;
    entryTxHash: string;
    remainingFraction: number;
    tiersHit: number;
    realisedPnlEth: number;
    lastExitPriceEth: number | null;
    lastExitTxHash: string | null;
    openedAt: string;
    closedAt: string | null;
  }): Position {
    return {
      id: row.id,
      postId: row.postId,
      authorXId: row.authorXId,
      authorHandle: row.authorHandle,
      authorAvatarUrl: undef(row.authorAvatarUrl),
      postUrl: undef(row.postUrl),
      order: row.order as unknown as TradeOrder,
      status: row.status as Position["status"],
      entryPriceEth: row.entryPriceEth,
      marketCapAtEntryUsd: undef(row.marketCapAtEntryUsd),
      entryTxHash: row.entryTxHash,
      remainingFraction: row.remainingFraction,
      tiersHit: row.tiersHit,
      realisedPnlEth: row.realisedPnlEth,
      lastExitPriceEth: undef(row.lastExitPriceEth),
      lastExitTxHash: undef(row.lastExitTxHash),
      openedAt: row.openedAt,
      closedAt: undef(row.closedAt),
    };
  }

  private rowToReview(row: {
    reviewedAt: string;
    postId: string;
    postUrl: string;
    authorXId: string;
    authorHandle: string;
    contractAddress: string;
    chain: string;
    authorScore: number;
    tokenScore: number;
    grade: string;
    decision: string;
    confidence: number;
    rationale: string;
    positionId: string | null;
    skippedReason: string | null;
  }): ReviewRecord {
    return {
      reviewedAt: row.reviewedAt,
      postId: row.postId,
      postUrl: row.postUrl,
      authorXId: row.authorXId,
      authorHandle: row.authorHandle,
      contractAddress: row.contractAddress,
      chain: row.chain as ReviewRecord["chain"],
      authorScore: row.authorScore,
      tokenScore: row.tokenScore,
      grade: row.grade as ReviewRecord["grade"],
      decision: row.decision as ReviewRecord["decision"],
      confidence: row.confidence,
      rationale: row.rationale,
      positionId: undef(row.positionId),
      skippedReason: undef(row.skippedReason),
    };
  }

  private rowToDistribution(row: {
    positionId: string;
    totalProfitEth: number;
    toAuthorEth: number;
    toPortfolioEth: number;
    toTeamEth: number;
    toBuybackEth: number;
    authorWallet: string | null;
  }): Distribution {
    return {
      positionId: row.positionId,
      totalProfitEth: row.totalProfitEth,
      toAuthorEth: row.toAuthorEth,
      toPortfolioEth: row.toPortfolioEth,
      toTeamEth: row.toTeamEth,
      toBuybackEth: row.toBuybackEth,
      // `authorWallet` is `string | null` (NOT optional) — preserve null.
      authorWallet: row.authorWallet,
    };
  }

  private rowToQueueItem(row: {
    submission: Prisma.JsonValue;
    priority: number;
    enqueuedAt: string;
  }): QueueItem {
    return {
      submission: row.submission as unknown as Submission,
      priority: row.priority,
      enqueuedAt: row.enqueuedAt,
    };
  }

  // ---- registry ------------------------------------------------------------

  async linkWallet(entry: RegistryEntry): Promise<void> {
    await this.prisma.registryEntry.upsert({
      where: { xUserId: entry.xUserId },
      create: entry,
      update: { handle: entry.handle, wallet: entry.wallet, linkedAt: entry.linkedAt },
    });
  }

  async getRegistryEntry(xUserId: string): Promise<RegistryEntry | null> {
    return this.prisma.registryEntry.findUnique({ where: { xUserId } });
  }

  // ---- positions -----------------------------------------------------------

  async savePosition(position: Position): Promise<void> {
    const data = {
      postId: position.postId,
      authorXId: position.authorXId,
      authorHandle: position.authorHandle,
      authorAvatarUrl: position.authorAvatarUrl ?? null,
      postUrl: position.postUrl ?? null,
      order: position.order as unknown as Prisma.InputJsonValue,
      status: position.status,
      entryPriceEth: position.entryPriceEth,
      marketCapAtEntryUsd: position.marketCapAtEntryUsd ?? null,
      entryTxHash: position.entryTxHash,
      remainingFraction: position.remainingFraction,
      tiersHit: position.tiersHit,
      realisedPnlEth: position.realisedPnlEth,
      lastExitPriceEth: position.lastExitPriceEth ?? null,
      lastExitTxHash: position.lastExitTxHash ?? null,
      openedAt: position.openedAt,
      closedAt: position.closedAt ?? null,
    };
    await this.prisma.position.upsert({
      where: { id: position.id },
      create: { id: position.id, ...data },
      update: data,
    });
  }

  async getOpenPositions(): Promise<Position[]> {
    // openedAt ASC mirrors FileStore's push-order (positions are opened in time order).
    const rows = await this.prisma.position.findMany({
      where: { status: "open" },
      orderBy: { openedAt: "asc" },
    });
    return rows.map((r) => this.rowToPosition(r));
  }

  async getAllPositions(): Promise<Position[]> {
    // openedAt ASC for deterministic ordering across SQLite page layouts.
    const rows = await this.prisma.position.findMany({ orderBy: { openedAt: "asc" } });
    return rows.map((r) => this.rowToPosition(r));
  }

  // ---- buy log -------------------------------------------------------------

  async recordBuy(isoAt: string): Promise<void> {
    await this.prisma.buyLog.create({ data: { isoAt } });
  }

  async countBuysSince(isoSince: string): Promise<number> {
    // Relies on ISO-8601 UTC ("Z") strings sorting lexicographically — the same
    // invariant FileStore's `t >= isoSince` string comparison depends on.
    return this.prisma.buyLog.count({ where: { isoAt: { gte: isoSince } } });
  }

  async lastBuyAt(): Promise<string | null> {
    // DESC on the ISO-8601 UTC string column gives the lexicographically largest
    // (most recent) timestamp — same as FileStore's reduce((a,b) => a>b?a:b).
    const row = await this.prisma.buyLog.findFirst({ orderBy: { isoAt: "desc" } });
    return row?.isoAt ?? null;
  }

  // ---- escrow --------------------------------------------------------------

  async addEscrow(xUserId: string, handle: string, amountEth: number): Promise<void> {
    // Single upsert with an atomic DB-side increment — no read-modify-write race.
    // Mirrors FileStore's `(existing?.amountEth ?? 0) + amountEth` accumulation
    // and stamps updatedAt to ISO now() on every call.
    const nowIso = new Date().toISOString();
    await this.prisma.escrow.upsert({
      where: { xUserId },
      create: { xUserId, handle, amountEth, updatedAt: nowIso },
      update: { amountEth: { increment: amountEth }, handle, updatedAt: nowIso },
    });
  }

  async getEscrow(xUserId: string): Promise<EscrowEntry | null> {
    return this.prisma.escrow.findUnique({ where: { xUserId } });
  }

  async clearEscrow(xUserId: string): Promise<void> {
    await this.prisma.escrow.deleteMany({ where: { xUserId } });
  }

  // ---- processed dedup -----------------------------------------------------

  async isProcessed(postId: string): Promise<boolean> {
    const row = await this.prisma.processedPost.findUnique({ where: { postId } });
    return row !== null;
  }

  async markProcessed(postId: string): Promise<void> {
    // Idempotent upsert — duplicate calls never throw a UNIQUE violation.
    // (FileStore's array.includes() guard; here the DB unique index is the guard.)
    await this.prisma.processedPost.upsert({
      where: { postId },
      create: { postId },
      update: {}, // already present — no-op
    });
    // Cap the dedup log to the last 5000 inserted (id ASC = insertion order).
    // Find the id of the row at position (count - PROCESSED_CAP) from the end;
    // delete everything with a lower id. Two queries instead of N+2.
    const cutoffRow = await this.prisma.processedPost.findFirst({
      orderBy: { id: "desc" },
      skip: PROCESSED_CAP - 1,
      select: { id: true },
    });
    if (cutoffRow !== null) {
      await this.prisma.processedPost.deleteMany({
        where: { id: { lt: cutoffRow.id } },
      });
    }
  }

  // ---- reviews -------------------------------------------------------------

  async saveReview(record: ReviewRecord): Promise<void> {
    await this.prisma.review.create({
      data: {
        reviewedAt: record.reviewedAt,
        postId: record.postId,
        postUrl: record.postUrl,
        authorXId: record.authorXId,
        authorHandle: record.authorHandle,
        contractAddress: record.contractAddress,
        chain: record.chain,
        authorScore: record.authorScore,
        tokenScore: record.tokenScore,
        grade: record.grade,
        decision: record.decision,
        confidence: record.confidence,
        rationale: record.rationale,
        positionId: record.positionId ?? null,
        skippedReason: record.skippedReason ?? null,
      },
    });
  }

  async getReviews(): Promise<ReviewRecord[]> {
    const rows = await this.prisma.review.findMany({ orderBy: { id: "asc" } });
    return rows.map((r) => this.rowToReview(r));
  }

  // ---- distributions -------------------------------------------------------

  async saveDistribution(dist: Distribution): Promise<void> {
    await this.prisma.distribution.create({
      data: {
        positionId: dist.positionId,
        totalProfitEth: dist.totalProfitEth,
        toAuthorEth: dist.toAuthorEth,
        toPortfolioEth: dist.toPortfolioEth,
        toTeamEth: dist.toTeamEth,
        toBuybackEth: dist.toBuybackEth,
        authorWallet: dist.authorWallet,
      },
    });
  }

  async getDistributions(): Promise<Distribution[]> {
    const rows = await this.prisma.distribution.findMany({ orderBy: { id: "asc" } });
    return rows.map((r) => this.rowToDistribution(r));
  }

  // ---- payout requests -----------------------------------------------------

  async addPayoutRequest(req: PayoutRequest): Promise<void> {
    await this.prisma.payoutRequest.upsert({
      where: { requestTweetId: req.requestTweetId },
      create: req,
      update: {
        xUserId: req.xUserId,
        handle: req.handle,
        threadPostId: req.threadPostId,
        requestedAt: req.requestedAt,
      },
    });
  }

  async getPayoutRequests(): Promise<PayoutRequest[]> {
    // requestedAt ASC for deterministic, oldest-first ordering.
    return this.prisma.payoutRequest.findMany({ orderBy: { requestedAt: "asc" } });
  }

  async clearPayoutRequestsForUser(xUserId: string): Promise<void> {
    await this.prisma.payoutRequest.deleteMany({ where: { xUserId } });
  }

  // ---- queue ---------------------------------------------------------------

  async enqueue(item: QueueItem): Promise<void> {
    await this.prisma.queueItem.create({
      data: {
        submission: item.submission as unknown as Prisma.InputJsonValue,
        priority: item.priority,
        enqueuedAt: item.enqueuedAt,
      },
    });
  }

  async getQueue(): Promise<QueueItem[]> {
    const rows = await this.prisma.queueItem.findMany({ orderBy: { id: "asc" } });
    return rows.map((r) => this.rowToQueueItem(r));
  }

  async dequeueHighest(): Promise<QueueItem | null> {
    // Highest priority wins; first-enqueued (lowest id) breaks ties — exactly
    // FileStore's "scan keeping the first maximum" behaviour.
    const row = await this.prisma.queueItem.findFirst({
      orderBy: [{ priority: "desc" }, { id: "asc" }],
    });
    if (row === null) return null;
    await this.prisma.queueItem.delete({ where: { id: row.id } });
    return this.rowToQueueItem(row);
  }

  async pruneQueue(isoCutoff: string): Promise<number> {
    // Relies on ISO-8601 UTC ("Z") strings sorting lexicographically — same as
    // FileStore's `q.enqueuedAt >= isoCutoff` string comparison. Removes rows
    // strictly before the cutoff; rows at or after the cutoff are kept.
    const { count } = await this.prisma.queueItem.deleteMany({
      where: { enqueuedAt: { lt: isoCutoff } },
    });
    return count;
  }

  // ---- funnel --------------------------------------------------------------

  async bumpFunnel(seen: number, passed: number): Promise<void> {
    await this.prisma.funnel.upsert({
      where: { id: FUNNEL_ID },
      create: { id: FUNNEL_ID, seen, passed },
      update: { seen: { increment: seen }, passed: { increment: passed } },
    });
  }

  async getFunnel(): Promise<Funnel> {
    const row = await this.prisma.funnel.findUnique({ where: { id: FUNNEL_ID } });
    return { seen: row?.seen ?? 0, passed: row?.passed ?? 0 };
  }
}
