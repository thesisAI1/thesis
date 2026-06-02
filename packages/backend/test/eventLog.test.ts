/**
 * RED tests for S3 — MemoryEventLog ring buffer + getEventLog() singleton.
 * Module does not exist yet — import will throw at runtime → RED.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";
import { MemoryEventLog, PrismaEventLog, buildEventLog, getEventLog } from "../src/observability/eventLog.js";

const makeEntry = (msg: string) => ({
  at: new Date().toISOString(),
  level: "info" as const,
  area: "test",
  type: "test:event",
  msg,
});

describe("MemoryEventLog", () => {
  it("caps at the given size — record 5 into cap-3, recent(10) returns 3", () => {
    const log = new MemoryEventLog(3);

    for (let i = 1; i <= 5; i++) {
      log.record(makeEntry(`entry-${i}`));
    }

    const all = log.recent(10);
    assert.equal(all.length, 3, "ring buffer should hold only 3 entries");
  });

  it("recent(n) returns the n newest entries newest-first", () => {
    const log = new MemoryEventLog(3);

    for (let i = 1; i <= 5; i++) {
      log.record(makeEntry(`entry-${i}`));
    }

    // After recording 1,2,3,4,5 with cap 3, buf contains [3,4,5].
    // recent(2) should return [5,4] (newest-first).
    const top2 = log.recent(2);
    assert.equal(top2.length, 2);
    assert.equal(top2[0].msg, "entry-5", "newest entry should be first");
    assert.equal(top2[1].msg, "entry-4");
  });

  it("recent(10) on a capped buffer returns newest-first", () => {
    const log = new MemoryEventLog(3);

    for (let i = 1; i <= 5; i++) {
      log.record(makeEntry(`entry-${i}`));
    }

    const all = log.recent(10);
    assert.equal(all[0].msg, "entry-5");
    assert.equal(all[1].msg, "entry-4");
    assert.equal(all[2].msg, "entry-3");
  });
});

describe("buildEventLog()", () => {
  it("sqlite mode returns PrismaEventLog", () => {
    const log = buildEventLog("sqlite", () => ({} as unknown as PrismaClient));
    assert.ok(log instanceof PrismaEventLog, "sqlite mode must return a PrismaEventLog");
  });

  it("file mode returns MemoryEventLog (thunk must NOT be called)", () => {
    const log = buildEventLog("file", () => {
      throw new Error("getPrisma must not be called in file mode");
    });
    assert.ok(log instanceof MemoryEventLog, "file mode must return a MemoryEventLog");
  });
});

describe("getEventLog()", () => {
  it("returns the same instance on two calls (singleton)", () => {
    const first = getEventLog();
    const second = getEventLog();
    assert.strictEqual(first, second, "getEventLog() must return the same singleton");
  });
});
