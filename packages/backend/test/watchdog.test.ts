/**
 * RED tests for S8 — watchdog with literal HEARTBEAT_STALE_SEC threshold.
 * Env must be set BEFORE import (config reads at module load).
 * markTick(atMs?) / checkLiveness(nowMs?) accept optional timestamps for deterministic testing.
 * Module does not exist yet → RED.
 */

// Set a small literal threshold so tests don't have to wait real time.
process.env.HEARTBEAT_STALE_SEC = "2";

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { markTick, checkLiveness } from "../src/observability/watchdog.js";
import { subscribeOps } from "../src/observability/opsBus.js";

describe("watchdog — literal threshold (HEARTBEAT_STALE_SEC=2)", () => {
  it("no liveness:stale event when elapsed < threshold", () => {
    const received: unknown[] = [];
    const unsub = subscribeOps((e) => received.push(e));

    markTick(1000);
    // 2500 - 1000 = 1500ms = 1.5s < 2s threshold → no event
    checkLiveness(2500);

    unsub();
    const staleEvents = (received as Array<Record<string, unknown>>).filter(
      (e) => e["type"] === "liveness:stale",
    );
    assert.equal(staleEvents.length, 0, "should not fire when elapsed < threshold");
  });

  it("emits liveness:stale when elapsed > threshold", () => {
    const received: unknown[] = [];
    const unsub = subscribeOps((e) => received.push(e));

    markTick(1000);
    // 4000 - 1000 = 3000ms = 3s > 2s threshold → should fire
    checkLiveness(4000);

    unsub();
    const staleEvents = (received as Array<Record<string, unknown>>).filter(
      (e) => e["type"] === "liveness:stale",
    );
    assert.equal(staleEvents.length, 1, "should emit liveness:stale when elapsed > threshold");
    assert.equal(staleEvents[0]?.["type"], "liveness:stale");
    assert.ok(
      typeof staleEvents[0]?.["secondsSinceTick"] === "number",
      "secondsSinceTick should be a number",
    );
  });
});
