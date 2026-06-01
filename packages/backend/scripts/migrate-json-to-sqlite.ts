/**
 * One-shot migration: JSON file store -> SQLite/Prisma store.
 *
 * Reads an existing `thesis-data.json` (the file the legacy FileStore wrote)
 * and replays every record into a PrismaStore over the same DATA_DIR, using the
 * Store interface so the exact upsert / append / accumulate semantics apply.
 *
 * Usage:
 *   npm run migrate:json -w @thesis/backend
 *   npm run migrate:json -w @thesis/backend -- /path/to/thesis-data.json
 *
 * Idempotent-ish: collections the interface UPSERTS (registry, positions,
 * pending buys, escrow, payout requests, processed) can be re-run safely.
 * Append-style collections (buy log incl. per-chain lanes, reviews,
 * distributions, queue) and the funnel would DOUBLE on a second run — run this
 * once against a fresh SQLite db.
 *
 * Per-chain fidelity: escrow keeps its `chain` (a Solana escrow owes SOL and
 * must never collapse into the base key), and the non-base buy lanes
 * (`buyLogByChain`) are replayed so per-chain cooldown/daily-limit history
 * survives — otherwise the bot could over-buy a non-base chain after cutover.
 *
 * Fidelity note: escrow `updatedAt` is re-stamped to now() because the only
 * interface entry point (addEscrow) accumulates and stamps the time itself.
 * The accumulated amount is preserved exactly; only the timestamp moves.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  Chain,
  Distribution,
  Position,
  RegistryEntry,
  ReviewRecord,
} from "@thesis/shared";
import { config } from "../src/config.js";
import type {
  EscrowEntry,
  Funnel,
  PayoutRequest,
  PendingBuy,
  QueueItem,
} from "../src/store/index.js";
import { PrismaStore } from "../src/store/prismaStore.js";

/** The on-disk shape the legacy FileStore persisted (see fileStore.ts). */
interface FileData {
  registry: Record<string, RegistryEntry>;
  positions: Position[];
  buyLog: string[];
  /** Per-chain (non-base) buy timestamps — mirrors FileStore Data.buyLogByChain. */
  buyLogByChain?: Record<string, string[]>;
  /** Pending-buy WAL markers — mirrors FileStore Data.pendingBuys. */
  pendingBuys: PendingBuy[];
  escrow: Record<string, EscrowEntry>;
  payoutRequests: Record<string, PayoutRequest>;
  processed: string[];
  reviews: ReviewRecord[];
  distributions: Distribution[];
  queue: QueueItem[];
  funnel: Funnel;
}

const EMPTY: FileData = {
  registry: {},
  positions: [],
  buyLog: [],
  pendingBuys: [],
  escrow: {},
  payoutRequests: {},
  processed: [],
  reviews: [],
  distributions: [],
  queue: [],
  funnel: { seen: 0, passed: 0 },
};

function resolveSourcePath(): string {
  const arg = process.argv[2];
  if (arg) return resolve(arg);
  return join(resolve(config.service.dataDir), "thesis-data.json");
}

function loadFileData(path: string): FileData {
  if (!existsSync(path)) {
    console.warn(`[migrate] no JSON file at ${path} — nothing to migrate, exiting.`);
    return { ...EMPTY };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<FileData>;
  return { ...EMPTY, ...parsed };
}

async function migrate(): Promise<void> {
  const sourcePath = resolveSourcePath();
  const data = loadFileData(sourcePath);
  const store = new PrismaStore(config.service.dataDir);

  // Upsert-style collections — safe to re-run.
  for (const entry of Object.values(data.registry)) {
    await store.linkWallet(entry);
  }
  // Mirror FileStore's schema-v1 migration: a CLOSED position written before
  // durable settlement existed has no `settledAt`. Stamp it terminally settled
  // here, exactly as FileStore.migrate() does on load — otherwise the monitor's
  // resume pass (getUnsettledClosedPositions = closed && !settledAt) would treat
  // every historical closed trade as unsettled and RE-PAY author + team +
  // buyback on the first tick. A loss-close has nothing to re-run, so stamping
  // all of them is safe; genuinely-unpaid authors use /admin/settle-stuck-payout.
  let stampedSettled = 0;
  for (const position of data.positions) {
    if (position.status === "closed" && !position.settledAt) {
      position.settledAt = position.closedAt ?? new Date().toISOString();
      position.settlement = {
        authorDone: true,
        teamDone: true,
        buybackDone: true,
        distributionDone: true,
      };
      stampedSettled += 1;
    }
    await store.savePosition(position);
  }
  if (stampedSettled > 0) {
    console.warn(
      `[migrate] stamped ${stampedSettled} pre-existing closed position(s) as ` +
        `already-settled (prevents re-paying historical trades).`,
    );
  }
  // Pending-buy WAL markers (crash-recovery). Upsert by postId — safe to re-run.
  for (const buy of data.pendingBuys) {
    await store.recordPendingBuy(buy);
  }
  for (const entry of Object.values(data.escrow)) {
    // Preserve the chain — a Solana escrow owes SOL; re-keying it to base would
    // sum two native balances under one key (the invariant escrow exists to keep).
    await store.addEscrow(entry.xUserId, entry.handle, entry.amountEth, entry.chain);
  }
  for (const req of Object.values(data.payoutRequests)) {
    await store.addPayoutRequest(req);
  }
  for (const postId of data.processed) {
    await store.markProcessed(postId);
  }

  // Append-style collections — preserve order; run once against a fresh db.
  for (const iso of data.buyLog) {
    await store.recordBuy(iso);
  }
  // Non-base buy lanes (e.g. solana) keep per-chain cooldown/daily-limit history.
  for (const [chain, isos] of Object.entries(data.buyLogByChain ?? {})) {
    for (const iso of isos) await store.recordBuy(iso, chain as Chain);
  }
  for (const review of data.reviews) {
    await store.saveReview(review);
  }
  for (const dist of data.distributions) {
    await store.saveDistribution(dist);
  }
  for (const item of data.queue) {
    await store.enqueue(item);
  }

  // Funnel is a single counter pair.
  if (data.funnel.seen !== 0 || data.funnel.passed !== 0) {
    await store.bumpFunnel(data.funnel.seen, data.funnel.passed);
  }

  await store.disconnect();

  const perChainBuys = Object.values(data.buyLogByChain ?? {}).reduce((n, a) => n + a.length, 0);
  console.log(
    `[migrate] done from ${sourcePath}: ` +
      `${Object.keys(data.registry).length} registry, ` +
      `${data.positions.length} positions, ` +
      `${data.pendingBuys.length} pending buys, ` +
      `${data.buyLog.length + perChainBuys} buys, ` +
      `${Object.keys(data.escrow).length} escrow, ` +
      `${Object.keys(data.payoutRequests).length} payout requests, ` +
      `${data.processed.length} processed, ` +
      `${data.reviews.length} reviews, ` +
      `${data.distributions.length} distributions, ` +
      `${data.queue.length} queued, ` +
      `funnel {seen:${data.funnel.seen}, passed:${data.funnel.passed}}.`,
  );
}

migrate().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exitCode = 1;
});
