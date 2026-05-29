import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { Distribution, Position, RegistryEntry, ReviewRecord } from "@thesis/shared";
import type { EscrowEntry, Funnel, PayoutRequest, QueueItem, Store } from "./index.js";

interface Data {
  registry: Record<string, RegistryEntry>;
  positions: Position[];
  buyLog: string[];
  escrow: Record<string, EscrowEntry>;
  payoutRequests: Record<string, PayoutRequest>;
  processed: string[];
  reviews: ReviewRecord[];
  distributions: Distribution[];
  queue: QueueItem[];
  funnel: Funnel;
}

const EMPTY: Data = {
  registry: {},
  positions: [],
  buyLog: [],
  escrow: {},
  payoutRequests: {},
  processed: [],
  reviews: [],
  distributions: [],
  queue: [],
  funnel: { seen: 0, passed: 0 },
};

/**
 * A JSON-file-backed Store. Loads once into memory, persists on every write.
 * Fine for local development volumes; production should implement the Store
 * interface against Postgres instead.
 *
 * Crash-safety:
 *   - persist() writes to `<file>.tmp` first, then POSIX-renames it over the
 *     real file. The rename is atomic — even mid-disaster the on-disk file is
 *     either the full previous version or the full new version, never a torn
 *     half-write that would crash the process on next boot.
 *   - Before the rename swap, the previous good file is copied to `<file>.bak`
 *     so a corrupt main file (e.g. disk full mid-rename) can still be
 *     recovered. Backup writes are best-effort: a failure here doesn't abort
 *     the persist — the new file still lands atomically.
 *   - On construction, loadOrRecover() tries the main file first; on parse
 *     failure it falls back to .bak; on double failure it starts EMPTY rather
 *     than crashing on boot.
 */
export class FileStore implements Store {
  private readonly file: string;
  private readonly tmpFile: string;
  private readonly bakFile: string;
  private data: Data;

  constructor(dataDir: string) {
    const dir = resolve(dataDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.file = join(dir, "thesis-data.json");
    this.tmpFile = this.file + ".tmp";
    this.bakFile = this.file + ".bak";
    this.data = this.loadOrRecover();
    this.persist();
  }

  /** Try the main file, then the .bak fallback, then EMPTY. Logs which path
   *  was used so an operator scanning startup output sees corruption events. */
  private loadOrRecover(): Data {
    if (existsSync(this.file)) {
      try {
        const json = readFileSync(this.file, "utf8");
        return { ...EMPTY, ...(JSON.parse(json) as Partial<Data>) };
      } catch (err) {
        console.warn(
          `[FileStore] main file is corrupt (${String(err)}) — trying backup`,
        );
      }
    }
    if (existsSync(this.bakFile)) {
      try {
        const json = readFileSync(this.bakFile, "utf8");
        console.warn(`[FileStore] recovered from backup ${this.bakFile}`);
        return { ...EMPTY, ...(JSON.parse(json) as Partial<Data>) };
      } catch (err) {
        console.error(
          `[FileStore] backup also corrupt (${String(err)}) — starting EMPTY`,
        );
      }
    }
    return { ...EMPTY };
  }

  /** Atomic write: stage to .tmp, copy current to .bak (best-effort), swap. */
  private persist(): void {
    const json = JSON.stringify(this.data, null, 2);
    // (1) Stage the new content in a sibling .tmp file. If we crash here, the
    // real file is untouched and the half-written .tmp is harmless.
    writeFileSync(this.tmpFile, json);
    // (2) Roll the current good file into .bak. Best-effort: if copy fails we
    // still proceed — losing a backup is better than losing the persist.
    if (existsSync(this.file)) {
      try {
        copyFileSync(this.file, this.bakFile);
      } catch (err) {
        console.warn(`[FileStore] backup copy failed (${String(err)}) — proceeding without`);
      }
    }
    // (3) Atomic rename — POSIX guarantees this is a single inode swap, so a
    // crash here leaves the file either fully old or fully new. Never torn.
    renameSync(this.tmpFile, this.file);
  }

  async linkWallet(entry: RegistryEntry): Promise<void> {
    this.data.registry[entry.xUserId] = entry;
    this.persist();
  }

  async getRegistryEntry(xUserId: string): Promise<RegistryEntry | null> {
    return this.data.registry[xUserId] ?? null;
  }

  async savePosition(position: Position): Promise<void> {
    const i = this.data.positions.findIndex((p) => p.id === position.id);
    if (i >= 0) this.data.positions[i] = position;
    else this.data.positions.push(position);
    this.persist();
  }

  async getOpenPositions(): Promise<Position[]> {
    return this.data.positions.filter((p) => p.status === "open");
  }

  async getAllPositions(): Promise<Position[]> {
    return [...this.data.positions];
  }

  async recordBuy(isoAt: string): Promise<void> {
    this.data.buyLog.push(isoAt);
    this.persist();
  }

  async countBuysSince(isoSince: string): Promise<number> {
    return this.data.buyLog.filter((t) => t >= isoSince).length;
  }

  async lastBuyAt(): Promise<string | null> {
    if (this.data.buyLog.length === 0) return null;
    return this.data.buyLog.reduce((a, b) => (a > b ? a : b));
  }

  async addEscrow(xUserId: string, handle: string, amountEth: number): Promise<void> {
    const existing = this.data.escrow[xUserId];
    this.data.escrow[xUserId] = {
      xUserId,
      handle,
      amountEth: (existing?.amountEth ?? 0) + amountEth,
      updatedAt: new Date().toISOString(),
    };
    this.persist();
  }

  async getEscrow(xUserId: string): Promise<EscrowEntry | null> {
    return this.data.escrow[xUserId] ?? null;
  }

  async isProcessed(postId: string): Promise<boolean> {
    return this.data.processed.includes(postId);
  }

  async markProcessed(postId: string): Promise<void> {
    if (!this.data.processed.includes(postId)) {
      this.data.processed.push(postId);
      // Cap the dedup log so the file never grows without bound.
      if (this.data.processed.length > 5000) {
        this.data.processed = this.data.processed.slice(-5000);
      }
      this.persist();
    }
  }

  async saveReview(record: ReviewRecord): Promise<void> {
    this.data.reviews.push(record);
    this.persist();
  }

  async getReviews(): Promise<ReviewRecord[]> {
    return [...this.data.reviews];
  }

  async saveDistribution(dist: Distribution): Promise<void> {
    this.data.distributions.push(dist);
    this.persist();
  }

  async getDistributions(): Promise<Distribution[]> {
    return [...this.data.distributions];
  }

  async clearEscrow(xUserId: string): Promise<void> {
    delete this.data.escrow[xUserId];
    this.persist();
  }

  async addPayoutRequest(req: PayoutRequest): Promise<void> {
    this.data.payoutRequests[req.requestTweetId] = req;
    this.persist();
  }

  async getPayoutRequests(): Promise<PayoutRequest[]> {
    return Object.values(this.data.payoutRequests);
  }

  async clearPayoutRequestsForUser(xUserId: string): Promise<void> {
    let changed = false;
    for (const [id, req] of Object.entries(this.data.payoutRequests)) {
      if (req.xUserId === xUserId) {
        delete this.data.payoutRequests[id];
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  async enqueue(item: QueueItem): Promise<void> {
    this.data.queue.push(item);
    this.persist();
  }

  async getQueue(): Promise<QueueItem[]> {
    return [...this.data.queue];
  }

  async dequeueHighest(): Promise<QueueItem | null> {
    if (this.data.queue.length === 0) return null;
    let best = 0;
    for (let i = 1; i < this.data.queue.length; i++) {
      if (this.data.queue[i].priority > this.data.queue[best].priority) best = i;
    }
    const [item] = this.data.queue.splice(best, 1);
    this.persist();
    return item ?? null;
  }

  async pruneQueue(isoCutoff: string): Promise<number> {
    const before = this.data.queue.length;
    this.data.queue = this.data.queue.filter((q) => q.enqueuedAt >= isoCutoff);
    const removed = before - this.data.queue.length;
    if (removed > 0) this.persist();
    return removed;
  }

  async bumpFunnel(seen: number, passed: number): Promise<void> {
    this.data.funnel.seen += seen;
    this.data.funnel.passed += passed;
    this.persist();
  }

  async getFunnel(): Promise<Funnel> {
    return { ...this.data.funnel };
  }
}
