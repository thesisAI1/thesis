/**
 * Store contract spec — ONE behavioural suite, run against BOTH implementations.
 *
 * The FileStore case is a CHARACTERISATION / REGRESSION GUARD: it pins today's
 * file-store behaviour and must be green immediately. The PrismaStore case is
 * the drop-in under test: it must reproduce every assertion identically.
 *
 * Because this is money-handling persistence, the bar is EXACT parity — down to
 * absent optional fields coming back as `undefined` (the JSON round-trip
 * behaviour), insertion-order tiebreaks, the 5000-row dedup cap, and ISO-string
 * (lexicographic) timestamp comparisons.
 *
 * Isolation: each test gets its own temp dir (so each store its own backing
 * file). For PrismaStore the schema is applied per-dir by replaying the
 * committed init migration against that dir's SQLite file.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import type {
  Distribution,
  Position,
  RegistryEntry,
  ReviewRecord,
  Submission,
} from "@thesis/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileStore } from "../src/store/fileStore.js";
import type { PayoutRequest, PendingBuy, QueueItem, Store } from "../src/store/index.js";
import { PrismaStore } from "../src/store/prismaStore.js";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const MIGRATION_SQL = resolve(
  HERE,
  "..",
  "prisma",
  "migrations",
  "20260529232305_init",
  "migration.sql",
);

/** A guaranteed-unique temp dir per test (mkdtempSync atomically creates a dir
 *  with a unique suffix — no Date.now()/Math.random(), no collision risk). The
 *  label is just a readable prefix. */
function freshDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `thesis-store-${label}-`));
}

/** Apply the committed init migration to a per-test SQLite file, so the
 *  PrismaStore case is schema-isolated and uses the SAME DDL as production. */
async function applySchema(dataDir: string): Promise<void> {
  const dbPath = resolve(dataDir, "thesis.db");
  const client = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
  });
  const sql = readFileSync(MIGRATION_SQL, "utf8");
  const statements = sql
    .split(";")
    // Drop `-- comment` lines inside each chunk (they precede every statement),
    // then keep only chunks that still hold real DDL.
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((stmt) => stmt.length > 0);
  for (const stmt of statements) {
    await client.$executeRawUnsafe(stmt);
  }
  await client.$disconnect();
}

interface Case {
  name: string;
  /** Build a fresh store over its own temp dir; returns the store + a teardown. */
  make: (label: string) => Promise<{ store: Store; teardown: () => Promise<void> }>;
}

const cases: Case[] = [
  {
    name: "FileStore",
    make: async (label) => {
      const dir = freshDir(`file-${label}`);
      return { store: new FileStore(dir), teardown: async () => {} };
    },
  },
  {
    name: "PrismaStore",
    make: async (label) => {
      const dir = freshDir(`prisma-${label}`);
      await applySchema(dir);
      const store = new PrismaStore(dir);
      return { store, teardown: () => store.disconnect() };
    },
  },
];

// ---- builders for valid domain objects (only the fields the methods touch) ----

function makeRegistry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    xUserId: "x-1",
    handle: "@alice",
    wallet: "0xWALLET",
    linkedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/** A Position with ALL optional fields OMITTED — used to assert null->undefined
 *  parity on read-back. */
function makeBarePosition(over: Partial<Position> = {}): Position {
  return {
    id: "pos-1",
    postId: "post-1",
    authorXId: "x-1",
    authorHandle: "@alice",
    order: {
      contractAddress: "0xCA",
      chain: "base",
      amountInEth: 0.05,
      takeProfits: [
        { priceX: 2, sellFraction: 0.5 },
        { priceX: 3, sellFraction: 0.25 },
      ],
      stopLossX: 0.7,
    },
    status: "open",
    entryPriceEth: 0.001,
    entryTxHash: "0xTX",
    remainingFraction: 1,
    tiersHit: 0,
    realisedPnlEth: 0,
    openedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function makeReview(over: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    reviewedAt: "2026-01-01T00:00:00.000Z",
    postId: "post-1",
    postUrl: "https://x.com/p/1",
    authorXId: "x-1",
    authorHandle: "@alice",
    contractAddress: "0xCA",
    chain: "base",
    authorScore: 80,
    tokenScore: 70,
    grade: "B",
    decision: "BUY",
    confidence: 0.6,
    rationale: "looks fine",
    ...over,
  };
}

function makeDistribution(over: Partial<Distribution> = {}): Distribution {
  return {
    positionId: "pos-1",
    totalProfitEth: 1,
    toAuthorEth: 0.25,
    toPortfolioEth: 0.25,
    toTeamEth: 0.25,
    toBuybackEth: 0.25,
    authorWallet: "0xWALLET",
    ...over,
  };
}

function makeSubmission(over: Partial<Submission> = {}): Submission {
  return {
    postId: "post-1",
    authorXId: "x-1",
    authorHandle: "@alice",
    thesisText: "this is the thesis",
    contractAddress: "0xCA",
    chain: "base",
    postUrl: "https://x.com/p/1",
    postedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function makePayoutRequest(over: Partial<PayoutRequest> = {}): PayoutRequest {
  return {
    requestTweetId: "req-1",
    xUserId: "x-1",
    handle: "@alice",
    threadPostId: "post-1",
    requestedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function makeQueueItem(over: Partial<QueueItem> = {}): QueueItem {
  return {
    submission: makeSubmission(),
    priority: 1,
    enqueuedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function makePendingBuy(over: Partial<PendingBuy> = {}): PendingBuy {
  return {
    postId: "post-1",
    contractAddress: "0xCA",
    amountInEth: 0.05,
    at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe.each(cases)("Store contract — $name", ({ name, make }) => {
  let store: Store;
  let teardown: () => Promise<void>;
  let label: string;
  let counter = 0;

  beforeEach(async (ctx) => {
    // Unique, deterministic-per-test label (no Math.random).
    label = `${name}-${counter++}-${ctx.task.id}`;
    const built = await make(label);
    store = built.store;
    teardown = built.teardown;
  });

  afterEach(async () => {
    await teardown();
  });

  // ---- registry ----
  it("linkWallet upserts by xUserId; getRegistryEntry returns entry or null", async () => {
    expect(await store.getRegistryEntry("x-1")).toBeNull();
    await store.linkWallet(makeRegistry({ wallet: "0xA" }));
    expect(await store.getRegistryEntry("x-1")).toEqual(makeRegistry({ wallet: "0xA" }));
    // upsert (same xUserId) overwrites
    await store.linkWallet(makeRegistry({ wallet: "0xB", handle: "@alice2" }));
    expect(await store.getRegistryEntry("x-1")).toEqual(
      makeRegistry({ wallet: "0xB", handle: "@alice2" }),
    );
  });

  // ---- positions ----
  it("savePosition upserts by id; getOpenPositions filters status==open; getAllPositions returns all", async () => {
    await store.savePosition(makeBarePosition({ id: "p1", status: "open" }));
    await store.savePosition(makeBarePosition({ id: "p2", status: "closed" }));
    const open = await store.getOpenPositions();
    expect(open.map((p) => p.id)).toEqual(["p1"]);
    expect((await store.getAllPositions()).map((p) => p.id).sort()).toEqual(["p1", "p2"]);

    // upsert p1 -> closed
    await store.savePosition(makeBarePosition({ id: "p1", status: "closed" }));
    expect(await store.getOpenPositions()).toEqual([]);
    expect((await store.getAllPositions()).length).toBe(2);
  });

  it("PARITY: a position saved with NO optional fields reads back with those keys undefined", async () => {
    const bare = makeBarePosition({ id: "bare" });
    // sanity: the builder really omits the optionals
    expect("authorAvatarUrl" in bare).toBe(false);
    await store.savePosition(bare);
    const [read] = await store.getAllPositions();
    // Deep-equal against the exact object FileStore would hand back.
    expect(read).toEqual(bare);
    // explicit: optional keys are undefined, not null
    expect(read.authorAvatarUrl).toBeUndefined();
    expect(read.postUrl).toBeUndefined();
    expect(read.marketCapAtEntryUsd).toBeUndefined();
    expect(read.lastExitPriceEth).toBeUndefined();
    expect(read.lastExitTxHash).toBeUndefined();
    expect(read.closedAt).toBeUndefined();
  });

  it("PARITY: a position with all optional fields set round-trips exactly", async () => {
    const full = makeBarePosition({
      id: "full",
      authorAvatarUrl: "https://img/avatar.png",
      postUrl: "https://x.com/p/1",
      marketCapAtEntryUsd: 123456,
      lastExitPriceEth: 0.002,
      lastExitTxHash: "0xEXIT",
      status: "closed",
      closedAt: "2026-02-01T00:00:00.000Z",
    });
    await store.savePosition(full);
    const [read] = await store.getAllPositions();
    expect(read).toEqual(full);
  });

  // ---- buy log ----
  it("recordBuy appends; countBuysSince counts >= isoSince (lexicographic); lastBuyAt = max or null", async () => {
    expect(await store.lastBuyAt()).toBeNull();
    expect(await store.countBuysSince("2026-01-01T00:00:00.000Z")).toBe(0);

    await store.recordBuy("2026-01-01T10:00:00.000Z");
    await store.recordBuy("2026-01-01T12:00:00.000Z");
    await store.recordBuy("2026-01-02T08:00:00.000Z");

    expect(await store.countBuysSince("2026-01-01T12:00:00.000Z")).toBe(2);
    expect(await store.countBuysSince("2026-01-03T00:00:00.000Z")).toBe(0);
    expect(await store.lastBuyAt()).toBe("2026-01-02T08:00:00.000Z");
  });

  // ---- escrow ----
  it("addEscrow ACCUMULATES amountEth and stamps updatedAt; getEscrow returns entry/null; clearEscrow deletes", async () => {
    expect(await store.getEscrow("x-1")).toBeNull();
    await store.addEscrow("x-1", "@alice", 0.5);
    await store.addEscrow("x-1", "@alice2", 0.25);
    const e = await store.getEscrow("x-1");
    expect(e?.xUserId).toBe("x-1");
    expect(e?.amountEth).toBeCloseTo(0.75, 12);
    // latest handle + an ISO updatedAt
    expect(e?.handle).toBe("@alice2");
    expect(typeof e?.updatedAt).toBe("string");
    expect(e?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await store.clearEscrow("x-1");
    expect(await store.getEscrow("x-1")).toBeNull();
  });

  // ---- processed dedup ----
  it("markProcessed is idempotent; isProcessed reflects membership", async () => {
    expect(await store.isProcessed("a")).toBe(false);
    await store.markProcessed("a");
    await store.markProcessed("a"); // dedup — no throw, still single
    expect(await store.isProcessed("a")).toBe(true);
    expect(await store.isProcessed("b")).toBe(false);
  });

  it("markProcessed caps stored ids at 5000 keeping the LAST 5000 inserted", async () => {
    for (let i = 0; i < 5003; i++) {
      await store.markProcessed(`id-${i}`);
    }
    // first three evicted, last 5000 retained
    expect(await store.isProcessed("id-0")).toBe(false);
    expect(await store.isProcessed("id-1")).toBe(false);
    expect(await store.isProcessed("id-2")).toBe(false);
    expect(await store.isProcessed("id-3")).toBe(true);
    expect(await store.isProcessed("id-5002")).toBe(true);
  });

  // ---- reviews ----
  it("saveReview appends; getReviews returns oldest-first; duplicate postIds allowed", async () => {
    expect(await store.getReviews()).toEqual([]);
    await store.saveReview(makeReview({ postId: "post-1", rationale: "first" }));
    await store.saveReview(makeReview({ postId: "post-2", rationale: "second" }));
    await store.saveReview(makeReview({ postId: "post-1", rationale: "dup-allowed" }));
    const reviews = await store.getReviews();
    expect(reviews.map((r) => r.rationale)).toEqual(["first", "second", "dup-allowed"]);
    // a review saved with no optional fields reads back undefined (not null)
    expect(reviews[0].positionId).toBeUndefined();
    expect(reviews[0].skippedReason).toBeUndefined();
    expect(reviews[0]).toEqual(makeReview({ postId: "post-1", rationale: "first" }));
  });

  // ---- distributions ----
  it("saveDistribution appends; getDistributions oldest-first; duplicate positionIds allowed", async () => {
    expect(await store.getDistributions()).toEqual([]);
    await store.saveDistribution(makeDistribution({ positionId: "pos-1", totalProfitEth: 1 }));
    await store.saveDistribution(makeDistribution({ positionId: "pos-2", totalProfitEth: 2 }));
    await store.saveDistribution(makeDistribution({ positionId: "pos-1", totalProfitEth: 3 }));
    const dists = await store.getDistributions();
    expect(dists.map((d) => d.totalProfitEth)).toEqual([1, 2, 3]);
    // null authorWallet round-trips as null (it is `string | null`, not optional)
    await store.saveDistribution(makeDistribution({ positionId: "pos-3", authorWallet: null }));
    const last = (await store.getDistributions()).at(-1);
    expect(last?.authorWallet).toBeNull();
  });

  // ---- payout requests ----
  it("addPayoutRequest upserts by requestTweetId; getPayoutRequests = all; clearPayoutRequestsForUser drops that user's rows", async () => {
    await store.addPayoutRequest(makePayoutRequest({ requestTweetId: "r1", xUserId: "x-1" }));
    await store.addPayoutRequest(makePayoutRequest({ requestTweetId: "r2", xUserId: "x-2" }));
    await store.addPayoutRequest(makePayoutRequest({ requestTweetId: "r3", xUserId: "x-1" }));
    // upsert r1 (same key) overwrites, not duplicates
    await store.addPayoutRequest(
      makePayoutRequest({ requestTweetId: "r1", xUserId: "x-1", handle: "@updated" }),
    );
    let all = await store.getPayoutRequests();
    expect(all.length).toBe(3);
    expect(all.find((r) => r.requestTweetId === "r1")?.handle).toBe("@updated");

    await store.clearPayoutRequestsForUser("x-1");
    all = await store.getPayoutRequests();
    expect(all.map((r) => r.requestTweetId)).toEqual(["r2"]);
  });

  // ---- queue ----
  it("enqueue appends; getQueue = all; dequeueHighest = highest priority, first-enqueued on ties; null when empty", async () => {
    expect(await store.dequeueHighest()).toBeNull();

    await store.enqueue(makeQueueItem({ priority: 1, submission: makeSubmission({ postId: "lowA" }) }));
    await store.enqueue(makeQueueItem({ priority: 5, submission: makeSubmission({ postId: "highFirst" }) }));
    await store.enqueue(makeQueueItem({ priority: 5, submission: makeSubmission({ postId: "highSecond" }) }));
    await store.enqueue(makeQueueItem({ priority: 3, submission: makeSubmission({ postId: "mid" }) }));

    expect((await store.getQueue()).length).toBe(4);

    // highest priority (5), first-enqueued tiebreak -> "highFirst"
    const first = await store.dequeueHighest();
    expect(first?.submission.postId).toBe("highFirst");
    expect((await store.getQueue()).length).toBe(3);

    const second = await store.dequeueHighest();
    expect(second?.submission.postId).toBe("highSecond");

    const third = await store.dequeueHighest();
    expect(third?.submission.postId).toBe("mid");

    const fourth = await store.dequeueHighest();
    expect(fourth?.submission.postId).toBe("lowA");

    expect(await store.dequeueHighest()).toBeNull();
  });

  it("dequeueHighest round-trips the full submission shape", async () => {
    const sub = makeSubmission({ postId: "p", authorAvatarUrl: "https://img/x.png" });
    await store.enqueue(makeQueueItem({ priority: 2, enqueuedAt: "2026-01-01T00:00:00.000Z", submission: sub }));
    const item = await store.dequeueHighest();
    expect(item).toEqual(
      makeQueueItem({ priority: 2, enqueuedAt: "2026-01-01T00:00:00.000Z", submission: sub }),
    );
  });

  it("pruneQueue removes rows enqueued before cutoff (keeps >= cutoff) and returns count removed", async () => {
    await store.enqueue(makeQueueItem({ priority: 1, enqueuedAt: "2026-01-01T00:00:00.000Z" }));
    await store.enqueue(makeQueueItem({ priority: 1, enqueuedAt: "2026-01-02T00:00:00.000Z" }));
    await store.enqueue(makeQueueItem({ priority: 1, enqueuedAt: "2026-01-03T00:00:00.000Z" }));

    const removed = await store.pruneQueue("2026-01-02T00:00:00.000Z");
    expect(removed).toBe(1); // only the Jan-01 one is < cutoff
    const remaining = await store.getQueue();
    expect(remaining.map((q) => q.enqueuedAt).sort()).toEqual([
      "2026-01-02T00:00:00.000Z",
      "2026-01-03T00:00:00.000Z",
    ]);
    // nothing to prune -> 0
    expect(await store.pruneQueue("2026-01-01T00:00:00.000Z")).toBe(0);
  });

  // ---- funnel ----
  it("bumpFunnel accumulates seen/passed; getFunnel starts {0,0}", async () => {
    expect(await store.getFunnel()).toEqual({ seen: 0, passed: 0 });
    await store.bumpFunnel(3, 1);
    await store.bumpFunnel(2, 2);
    expect(await store.getFunnel()).toEqual({ seen: 5, passed: 3 });
  });

  // ---- NEW PINNED INVARIANTS (from Phase-1 review) ----

  it("addEscrow increment: three sequential calls accumulate correctly without read-modify-write races", async () => {
    // Each call must add its delta to whatever is already stored (not replace).
    await store.addEscrow("x-2", "@bob", 0.1);
    await store.addEscrow("x-2", "@bob", 0.2);
    await store.addEscrow("x-2", "@bob", 0.3);
    const e = await store.getEscrow("x-2");
    // 0.1 + 0.2 + 0.3 = 0.6 — using closeTo to tolerate IEEE-754 rounding.
    expect(e?.amountEth).toBeCloseTo(0.6, 12);
    // The most recent handle wins.
    expect(e?.handle).toBe("@bob");
  });

  it("markProcessed double-call never throws; second call is a no-op", async () => {
    await store.markProcessed("dup-post");
    // Second call must not throw a UNIQUE constraint or any other error.
    await expect(store.markProcessed("dup-post")).resolves.toBeUndefined();
    expect(await store.isProcessed("dup-post")).toBe(true);
  });

  it("getAllPositions and getOpenPositions return deterministic openedAt-asc order (insert chronologically so both impls agree)", async () => {
    // Insert in openedAt chronological order so FileStore's push-order
    // (which is insertion order) aligns with PrismaStore's openedAt ASC sort.
    await store.savePosition(makeBarePosition({ id: "older", status: "open", openedAt: "2026-01-01T00:00:00.000Z" }));
    await store.savePosition(makeBarePosition({ id: "newer", status: "open", openedAt: "2026-02-01T00:00:00.000Z" }));

    const all = await store.getAllPositions();
    expect(all.map((p) => p.id)).toEqual(["older", "newer"]);

    const open = await store.getOpenPositions();
    expect(open.map((p) => p.id)).toEqual(["older", "newer"]);
  });

  it("getPayoutRequests returns rows in requestedAt order (insert chronologically so insertion-order == requestedAt-order)", async () => {
    // Insert in chronological order so FileStore's object-insertion-order
    // matches requestedAt ASC — both implementations then agree.
    await store.addPayoutRequest(makePayoutRequest({ requestTweetId: "early", requestedAt: "2026-01-01T00:00:00.000Z" }));
    await store.addPayoutRequest(makePayoutRequest({ requestTweetId: "late", requestedAt: "2026-02-01T00:00:00.000Z" }));
    const all = await store.getPayoutRequests();
    expect(all.map((r) => r.requestTweetId)).toEqual(["early", "late"]);
  });

  // ---- settlement durability (PR3) ----
  it("getUnsettledClosedPositions = closed && !settledAt (open + settled excluded)", async () => {
    await store.savePosition(makeBarePosition({ id: "open", status: "open" }));
    await store.savePosition(
      makeBarePosition({ id: "unsettled", status: "closed", closedAt: "2026-02-01T00:00:00.000Z" }),
    );
    await store.savePosition(
      makeBarePosition({
        id: "settled",
        status: "closed",
        closedAt: "2026-02-01T00:00:00.000Z",
        settledAt: "2026-02-01T00:05:00.000Z",
        settlement: { authorDone: true, teamDone: true, buybackDone: true, distributionDone: true },
      }),
    );
    const unsettled = await store.getUnsettledClosedPositions();
    expect(unsettled.map((p) => p.id)).toEqual(["unsettled"]);
  });

  it("PARITY: settledAt + settlement round-trip exactly; never-set reads back undefined", async () => {
    const settlement = {
      authorDone: true,
      teamDone: false,
      buybackDone: true,
      distributionDone: false,
    };
    const p = makeBarePosition({
      id: "s",
      status: "closed",
      closedAt: "2026-02-01T00:00:00.000Z",
      settledAt: "2026-02-01T00:05:00.000Z",
      settlement,
    });
    await store.savePosition(p);
    await store.savePosition(makeBarePosition({ id: "bare2" }));
    const read = (await store.getAllPositions()).find((x) => x.id === "s")!;
    expect(read).toEqual(p);
    expect(read.settledAt).toBe("2026-02-01T00:05:00.000Z");
    expect(read.settlement).toEqual(settlement);
    // a position that was never settled reads back with BOTH fields undefined
    const bare = (await store.getAllPositions()).find((x) => x.id === "bare2")!;
    expect(bare.settledAt).toBeUndefined();
    expect(bare.settlement).toBeUndefined();
  });

  // ---- pending-buy write-ahead log ----
  it("recordPendingBuy upserts by postId; getPendingBuys lists; clearPendingBuy removes", async () => {
    expect(await store.getPendingBuys()).toEqual([]);
    await store.recordPendingBuy(makePendingBuy({ postId: "p1", amountInEth: 0.05 }));
    await store.recordPendingBuy(
      makePendingBuy({ postId: "p2", amountInEth: 0.1, at: "2026-01-02T00:00:00.000Z" }),
    );
    // re-record the same postId with new data -> replaces, never duplicates
    await store.recordPendingBuy(makePendingBuy({ postId: "p1", amountInEth: 0.07 }));
    const all = await store.getPendingBuys();
    expect(all.length).toBe(2);
    expect(all.find((b) => b.postId === "p1")?.amountInEth).toBeCloseTo(0.07, 12);

    await store.clearPendingBuy("p1");
    expect((await store.getPendingBuys()).map((b) => b.postId)).toEqual(["p2"]);
  });

  // ---- per-chain escrow isolation ----
  it("escrow is per (author, chain) — base and solana never sum; clear is per chain", async () => {
    await store.addEscrow("x-1", "@alice", 0.5, "base");
    await store.addEscrow("x-1", "@alice", 0.3, "solana");
    expect((await store.getEscrow("x-1", "base"))?.amountEth).toBeCloseTo(0.5, 12);
    expect((await store.getEscrow("x-1", "solana"))?.amountEth).toBeCloseTo(0.3, 12);
    expect((await store.getEscrow("x-1", "solana"))?.chain).toBe("solana");

    await store.clearEscrow("x-1", "base");
    expect(await store.getEscrow("x-1", "base")).toBeNull();
    expect((await store.getEscrow("x-1", "solana"))?.amountEth).toBeCloseTo(0.3, 12);
  });

  // ---- per-chain buy lanes (independent cooldown/limit history) ----
  it("buy lanes are independent per chain; default (no chain) is the base lane", async () => {
    await store.recordBuy("2026-01-01T10:00:00.000Z", "base");
    await store.recordBuy("2026-01-01T11:00:00.000Z", "base");
    await store.recordBuy("2026-01-01T12:00:00.000Z", "solana");
    expect(await store.countBuysSince("2026-01-01T00:00:00.000Z", "base")).toBe(2);
    expect(await store.countBuysSince("2026-01-01T00:00:00.000Z", "solana")).toBe(1);
    expect(await store.lastBuyAt("base")).toBe("2026-01-01T11:00:00.000Z");
    expect(await store.lastBuyAt("solana")).toBe("2026-01-01T12:00:00.000Z");
    // no-chain call resolves to the base lane (back-compat default)
    expect(await store.countBuysSince("2026-01-01T00:00:00.000Z")).toBe(2);
  });

  // ---- clearPayout: atomic + per-chain scoped ----
  it("clearPayout drops escrow + payout requests for ONE chain only (base leaves solana intact)", async () => {
    await store.addEscrow("x-9", "@bob", 0.4, "base");
    await store.addEscrow("x-9", "@bob", 0.2, "solana");
    await store.addPayoutRequest(makePayoutRequest({ requestTweetId: "b1", xUserId: "x-9", chain: "base" }));
    await store.addPayoutRequest(
      makePayoutRequest({ requestTweetId: "s1", xUserId: "x-9", chain: "solana" }),
    );

    await store.clearPayout("x-9", "base");

    expect(await store.getEscrow("x-9", "base")).toBeNull();
    expect((await store.getEscrow("x-9", "solana"))?.amountEth).toBeCloseTo(0.2, 12);
    expect((await store.getPayoutRequests()).map((r) => r.requestTweetId)).toEqual(["s1"]);
  });

  // ---- per-chain registry (one wallet per chain) ----
  it("registry is per (author, chain) — base and solana wallets are independent", async () => {
    await store.linkWallet(makeRegistry({ xUserId: "x-7", wallet: "0xBASE" }));
    await store.linkWallet(makeRegistry({ xUserId: "x-7", wallet: "SoLwAlLeT", chain: "solana" }));
    expect((await store.getRegistryEntry("x-7"))?.wallet).toBe("0xBASE");
    const sol = await store.getRegistryEntry("x-7", "solana");
    expect(sol?.wallet).toBe("SoLwAlLeT");
    expect(sol?.chain).toBe("solana");
  });
});
