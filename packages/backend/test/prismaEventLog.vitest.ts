/**
 * PrismaEventLog — write-through + durable history + crash-safety
 *
 * RED pins (must fail before PrismaEventLog exists, then pass after impl):
 *   1. Write-through sync visibility
 *   2. Durable restart-safety (second client over same dir)
 *   3. Crash-safety (stub client whose create() rejects)
 *   4. opsType persisted/null round-trip
 *   5. Retention prune (cap:3, pruneEvery:1, record 5)
 *   6. MemoryEventLog.history() === recent()
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import type { EventLogEntry } from "@thesis/shared";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MemoryEventLog, PrismaEventLog } from "../src/observability/eventLog.js";
import { applySchema } from "./helpers/applySchema.js";

// ── dir helper ────────────────────────────────────────────────────────────────

function freshDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `thesis-eventlog-${label}-`));
}

// ── helpers ───────────────────────────────────────────────────────────────────

function makeEntry(over: Partial<EventLogEntry> = {}): EventLogEntry {
  return {
    at: new Date().toISOString(),
    level: "info",
    area: "test",
    type: "test:event",
    msg: "hello",
    ...over,
  };
}

/** Poll fn() until ok(value) is true or timeoutMs elapses.
 *  Returns the last value — the calling assertion then reports the real diff. */
async function waitUntil<T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  timeoutMs = 2000,
  stepMs = 10,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() - start > timeoutMs) return v;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

// ── test lifecycle ────────────────────────────────────────────────────────────

let dir: string;
let prisma: PrismaClient;

beforeEach(async () => {
  dir = freshDir("case");
  await applySchema(dir);
  prisma = new PrismaClient({
    datasources: { db: { url: `file:${resolve(dir, "thesis.db")}` } },
  });
});

afterEach(async () => {
  await prisma.$disconnect();
});

// ── pin 1: write-through sync visibility ─────────────────────────────────────

it("record() returns synchronously and recent(1)[0] equals the entry immediately (no await)", () => {
  const log = new PrismaEventLog({ prisma });
  const entry = makeEntry();
  log.record(entry);
  // No await — the ring must be updated synchronously
  expect(log.recent(1)[0]).toEqual(entry);
});

// ── pin 2: durable restart-safety ────────────────────────────────────────────

it("history() returns entry after simulated process restart (second client, same dir)", async () => {
  const log = new PrismaEventLog({ prisma });
  const entry = makeEntry({ msg: "survives restart" });
  log.record(entry);

  // Simulate restart: build a SECOND PrismaEventLog over the same dir with a NEW client
  const prisma2 = new PrismaClient({
    datasources: { db: { url: `file:${resolve(dir, "thesis.db")}` } },
  });
  try {
    const log2 = new PrismaEventLog({ prisma: prisma2 });
    // Poll until persist() has flushed — do NOT use a fixed sleep
    const rows = await waitUntil(() => log2.history({ limit: 10 }), (v) => v.length >= 1);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const found = rows.find((r) => r.msg === "survives restart");
    expect(found).toBeDefined();
    expect(found?.level).toBe("info");
    expect(found?.area).toBe("test");
    expect(found?.type).toBe("test:event");
  } finally {
    await prisma2.$disconnect();
  }
});

// ── pin 3: crash-safety ───────────────────────────────────────────────────────

it("record() does NOT throw and recent(1)[0] is set even when DB create rejects", () => {
  const stubPrisma = {
    event: {
      create: async () => { throw new Error("boom"); },
      findFirst: async () => null,
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
    },
  } as unknown as PrismaClient;

  const log = new PrismaEventLog({ prisma: stubPrisma });
  const entry = makeEntry({ msg: "crash-safe" });

  // Must not throw
  expect(() => log.record(entry)).not.toThrow();
  // Ring updated despite DB failure
  expect(log.recent(1)[0]).toEqual(entry);
});

// ── pin 4: opsType persisted/null round-trip ──────────────────────────────────

it("opsType is persisted when set and comes back undefined when absent", async () => {
  const log = new PrismaEventLog({ prisma });
  const withOps = makeEntry({ opsType: "trade:buy", msg: "with-ops" });
  const withoutOps = makeEntry({ msg: "no-ops" });
  log.record(withOps);
  log.record(withoutOps);

  // Poll until both records are visible in the DB
  const rows = await waitUntil(() => log.history({ limit: 10 }), (v) => v.length >= 2);
  const found1 = rows.find((r) => r.msg === "with-ops");
  const found2 = rows.find((r) => r.msg === "no-ops");
  expect(found1?.opsType).toBe("trade:buy");
  expect(found2?.opsType).toBeUndefined();
});

// ── pin 5: retention prune ───────────────────────────────────────────────────

it("history() returns only the newest cap entries after prune (cap:3, pruneEvery:1)", async () => {
  const log = new PrismaEventLog({ prisma, cap: 3, pruneEvery: 1 });
  // Serialize inserts: await each persist+prune to finish before firing the next.
  // pruneEvery:1 triggers a prune on EVERY write; concurrent prunes on the same
  // SQLite connection produce SQLITE_BUSY / empty engine responses.
  for (let i = 1; i <= 5; i++) {
    const count = i; // capture for closure
    log.record(makeEntry({ msg: `entry-${count}` }));
    // Poll until this entry (or a later prune result) is visible in the DB before
    // recording the next — ensures serial persist+prune on the single writer.
    await waitUntil(
      () => log.history({ limit: 10 }),
      (v) => v.some((r) => r.msg === `entry-${count}`),
    );
  }

  // After all 5 inserts+prunes have settled, poll until exactly 3 rows remain with entry-5
  const rows = await waitUntil(
    () => log.history({ limit: 10 }),
    (v) => v.length === 3 && v.some((r) => r.msg === "entry-5"),
  );
  // Exactly 3 rows remain (the newest 3)
  expect(rows.length).toBe(3);
  const msgs = rows.map((r) => r.msg);
  expect(msgs).toContain("entry-5");
  expect(msgs).toContain("entry-4");
  expect(msgs).toContain("entry-3");
  expect(msgs).not.toContain("entry-1");
  expect(msgs).not.toContain("entry-2");
});

// ── pin 6: MemoryEventLog.history() === recent() ─────────────────────────────

it("MemoryEventLog.history() returns same entries as recent() (graceful degrade)", async () => {
  const mem = new MemoryEventLog();
  const a = makeEntry({ msg: "a" });
  const b = makeEntry({ msg: "b" });
  const c = makeEntry({ msg: "c" });
  mem.record(a);
  mem.record(b);
  mem.record(c);

  const fromHistory = await mem.history({ limit: 2 });
  const fromRecent = mem.recent(2);
  expect(fromHistory).toEqual(fromRecent);
});

// ── pin 7: area filter pushed down into DB (RED) ─────────────────────────────

it("PrismaEventLog.history({ area }) returns ONLY rows matching that area", async () => {
  const log = new PrismaEventLog({ prisma });
  log.record(makeEntry({ area: "monitor", msg: "m1" }));
  log.record(makeEntry({ area: "payout",  msg: "p1" }));
  log.record(makeEntry({ area: "monitor", msg: "m2" }));
  log.record(makeEntry({ area: "payout",  msg: "p2" }));

  // Poll until both monitor rows are visible in the DB
  const rows = await waitUntil(
    () => log.history({ limit: 10, area: "monitor" }),
    (v) => v.length >= 2,
  );
  expect(rows.length).toBe(2);
  for (const r of rows) {
    expect(r.area).toBe("monitor");
  }
  expect(rows.map((r) => r.msg)).toEqual(expect.arrayContaining(["m1", "m2"]));
  expect(rows.find((r) => r.area === "payout")).toBeUndefined();
});

// ── pin 8: level filter pushed down into DB (RED) ────────────────────────────

it("PrismaEventLog.history({ level }) returns ONLY rows matching that level", async () => {
  const log = new PrismaEventLog({ prisma });
  log.record(makeEntry({ level: "info",  msg: "i1" }));
  log.record(makeEntry({ level: "error", msg: "e1" }));
  log.record(makeEntry({ level: "warn",  msg: "w1" }));
  log.record(makeEntry({ level: "error", msg: "e2" }));

  // Poll until both error rows are visible in the DB
  const rows = await waitUntil(
    () => log.history({ limit: 10, level: "error" }),
    (v) => v.length >= 2,
  );
  expect(rows.length).toBe(2);
  for (const r of rows) {
    expect(r.level).toBe("error");
  }
  expect(rows.map((r) => r.msg)).toEqual(expect.arrayContaining(["e1", "e2"]));
});

// ── pin 9: MemoryEventLog area/level filter parity (RED) ─────────────────────

it("MemoryEventLog.history({ area }) filters by area", async () => {
  const mem = new MemoryEventLog();
  mem.record(makeEntry({ area: "monitor", msg: "m" }));
  mem.record(makeEntry({ area: "payout",  msg: "p" }));

  const rows = await mem.history({ limit: 10, area: "monitor" });
  expect(rows.length).toBe(1);
  expect(rows[0].area).toBe("monitor");
});

it("MemoryEventLog.history({ level }) filters by level", async () => {
  const mem = new MemoryEventLog();
  mem.record(makeEntry({ level: "info",  msg: "i" }));
  mem.record(makeEntry({ level: "error", msg: "e" }));

  const rows = await mem.history({ limit: 10, level: "error" });
  expect(rows.length).toBe(1);
  expect(rows[0].level).toBe("error");
});

// ── pin 10: #2 RED→GREEN: history() ordered by event time (at), not insert id ──

it("#2 RED→GREEN: history() orders by at desc (event time), not id desc (insert order)", async () => {
  // Seed: insert entry A with NEWER at first, then B with OLDER at.
  // A gets the LOWER id (inserted first), B gets the HIGHER id.
  // id desc → returns B first (wrong). at desc → returns A first (correct).
  const log = new PrismaEventLog({ prisma });

  const atA = "2026-06-02T10:00:00.000Z"; // newer timestamp
  const atB = "2026-06-02T09:00:00.000Z"; // older timestamp

  // Insert A first (lower id) with newer at
  log.record(makeEntry({ at: atA, msg: "entry-A" }));
  // Wait for A to persist before inserting B so B gets a higher id
  await waitUntil(
    () => log.history({ limit: 10 }),
    (v) => v.some((r) => r.msg === "entry-A"),
  );

  // Insert B second (higher id) with older at
  log.record(makeEntry({ at: atB, msg: "entry-B" }));
  await waitUntil(
    () => log.history({ limit: 10 }),
    (v) => v.some((r) => r.msg === "entry-B"),
  );

  const rows = await log.history({ limit: 2 });
  expect(rows.length).toBeGreaterThanOrEqual(2);
  // Newest by event time (A) must come first
  expect(rows[0].at).toBe(atA);
  expect(rows[0].msg).toBe("entry-A");
});
