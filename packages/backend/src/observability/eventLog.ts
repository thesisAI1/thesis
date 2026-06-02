import type { PrismaClient } from "@prisma/client";
import { config } from "../config.js";
import type { EventLogEntry } from "@thesis/shared";
import { getStore, PrismaStore } from "../store/index.js";

export type { EventLogEntry };

// ── Types ───────────────────────────────────────────────────────────────────

export interface EventLog {
  record(entry: EventLogEntry): void;
  recent(n: number): EventLogEntry[];
  history(opts: { limit: number; opsTypes?: string[]; area?: string; level?: string }): Promise<EventLogEntry[]>;
}

// ── MemoryEventLog ──────────────────────────────────────────────────────────

export class MemoryEventLog implements EventLog {
  private readonly cap: number;
  private buf: EventLogEntry[] = [];

  constructor(cap?: number) {
    // Guard against cap <= 0 (e.g. OBS_RECENT_BUFFER_SIZE=0), which would make
    // slice(-0) silently discard every entry — the buffer must hold >= 1.
    this.cap = Math.max(1, cap ?? config.observability.recentBufferSize);
  }

  record(entry: EventLogEntry): void {
    this.buf.push(entry);
    if (this.buf.length > this.cap) {
      this.buf = this.buf.slice(this.buf.length - this.cap);
    }
  }

  recent(n: number): EventLogEntry[] {
    return this.buf.slice().reverse().slice(0, n);
  }

  async history(opts: { limit: number; opsTypes?: string[]; area?: string; level?: string }): Promise<EventLogEntry[]> {
    let r = this.recent(opts.limit);
    // Guard: filter out entries where opsType is undefined when filtering by opsType.
    // Only include non-empty opsType values to prevent undefined from matching.
    const validOpsTypes = opts.opsTypes?.filter((t) => t.length > 0);
    if (validOpsTypes?.length) {
      r = r.filter((e) => e.opsType !== undefined && validOpsTypes.includes(e.opsType));
    }
    if (opts.area !== undefined) r = r.filter((e) => e.area === opts.area);
    if (opts.level !== undefined) r = r.filter((e) => e.level === opts.level);
    return r;
  }
}

// ── PrismaEventLog ──────────────────────────────────────────────────────────

export class PrismaEventLog implements EventLog {
  private readonly prisma: PrismaClient;
  private readonly ring: MemoryEventLog;
  private readonly cap: number;
  // pruneEvery:200 amortizes the prune cost — one cheap DELETE every 200 writes
  // rather than on every insert, keeping the hot trading-loop latency minimal.
  private readonly pruneEvery: number;
  private writes = 0;

  // Client is ALWAYS injected — PrismaEventLog must NEVER call `new PrismaClient()`.
  // (One client shared with PrismaStore; two clients on one SQLite file contend on the
  //  write lock → SQLITE_BUSY on the live loop.)
  constructor(opts: { prisma: PrismaClient; ring?: MemoryEventLog; cap?: number; pruneEvery?: number }) {
    this.prisma = opts.prisma;
    this.ring = opts.ring ?? new MemoryEventLog();
    this.cap = Math.max(1, opts.cap ?? config.observability.eventLogCap);
    this.pruneEvery = Math.max(1, opts.pruneEvery ?? 200);
  }

  record(entry: EventLogEntry): void {
    this.ring.record(entry);     // write-through: instant, sync recent()
    void this.persist(entry);    // fire-and-forget; MUST NOT throw into the caller
  }

  recent(n: number): EventLogEntry[] {
    return this.ring.recent(n);
  }

  private async persist(entry: EventLogEntry): Promise<void> {
    try {
      await this.prisma.event.create({
        data: {
          at: entry.at, level: entry.level, area: entry.area,
          type: entry.type, msg: entry.msg, opsType: entry.opsType ?? null,
        },
      });
      if (++this.writes % this.pruneEvery === 0) await this.prune();
    } catch (e) {
      // Logging must never crash the trading loop — drop on failure.
      // DO NOT call logEvent/log here (would recurse through record→persist).
      console.error("[eventLog] persist failed:", e instanceof Error ? e.message : e);
    }
  }

  private async prune(): Promise<void> {
    const cutoff = await this.prisma.event.findFirst({
      orderBy: { id: "desc" }, skip: this.cap - 1, select: { id: true },
    });
    if (cutoff) await this.prisma.event.deleteMany({ where: { id: { lt: cutoff.id } } });
  }

  async history(opts: { limit: number; opsTypes?: string[]; area?: string; level?: string }): Promise<EventLogEntry[]> {
    const where: Record<string, unknown> = {};
    const validOpsTypes = opts.opsTypes?.filter((t) => t.length > 0);
    if (validOpsTypes?.length) where.opsType = { in: validOpsTypes };
    if (opts.area !== undefined) where.area = opts.area;
    if (opts.level !== undefined) where.level = opts.level;
    const rows = await this.prisma.event.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { id: "desc" },   // PK = insertion order = newest-first (cheap, monotonic)
      take: opts.limit,
    });
    return rows.map(r => ({
      at: r.at,
      level: r.level as EventLogEntry["level"],
      area: r.area, type: r.type, msg: r.msg,
      opsType: r.opsType ?? undefined,
    }));
  }
}

// ── Factory + Singleton ─────────────────────────────────────────────────────

/** Pure factory — sqlite ⇒ durable PrismaEventLog (sharing the store's client),
 *  else in-memory. `getPrisma` is invoked eagerly when storeMode is "sqlite";
 *  file/mock mode never reaches it, so no store/client is constructed. */
export function buildEventLog(storeMode: string, getPrisma: () => PrismaClient): EventLog {
  return storeMode === "sqlite"
    ? new PrismaEventLog({ prisma: getPrisma() })
    : new MemoryEventLog();
}

let instance: EventLog | undefined;

export function getEventLog(): EventLog {
  if (!instance) {
    // Same client as the store — one writer on thesis.db (no SQLITE_BUSY contention).
    instance = buildEventLog(config.service.store, () => {
      const store = getStore();
      if (!(store instanceof PrismaStore)) {
        throw new Error("getEventLog: store mode is sqlite but store is not a PrismaStore");
      }
      return store.client;
    });
  }
  return instance;
}

/** Reset the singleton — TEST USE ONLY. Prevents entries leaking across test files
 *  when the module is re-used across node:test suites in the same process. */
export function resetEventLogForTest(): void {
  instance = undefined;
}
