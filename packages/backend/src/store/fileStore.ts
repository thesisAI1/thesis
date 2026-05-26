import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
 */
export class FileStore implements Store {
  private readonly file: string;
  private data: Data;

  constructor(dataDir: string) {
    const dir = resolve(dataDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.file = join(dir, "thesis-data.json");
    this.data = existsSync(this.file)
      ? { ...EMPTY, ...(JSON.parse(readFileSync(this.file, "utf8")) as Partial<Data>) }
      : { ...EMPTY };
    this.persist();
  }

  private persist(): void {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2));
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
