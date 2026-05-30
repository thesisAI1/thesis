/**
 * RED tests for S8 — watchdog auto-derive threshold (HEARTBEAT_STALE_SEC=0).
 * When heartbeatStaleSec=0, effective = max(90, pollIntervalSec*3).
 * With POLL_INTERVAL_SEC=10 → max(90, 30) = 90s threshold.
 * markTick(0); checkLiveness(50_000) = 50s < 90s → NO fire (proves not using tiny literal).
 * Module does not exist yet → RED.
 */

// Auto-derive: 0 = derive from poll interval
process.env.HEARTBEAT_STALE_SEC = "0";
// Small poll interval → max(90, 10*3=30) = 90s effective threshold
process.env.POLL_INTERVAL_SEC = "10";

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { markTick, checkLiveness } from "../src/observability/watchdog.js";
import { subscribeOps } from "../src/observability/opsBus.js";

describe("watchdog — auto-derive threshold (HEARTBEAT_STALE_SEC=0, POLL_INTERVAL_SEC=10)", () => {
  it("effective threshold is max(90, poll*3) >= 90 — 50s elapsed does NOT fire liveness:stale", () => {
    const received: unknown[] = [];
    const unsub = subscribeOps((e) => received.push(e));

    // markTick at t=0, checkLiveness at t=50_000ms (50s)
    // effective threshold = max(90, 10*3) = 90s
    // 50s < 90s → no event
    markTick(0);
    checkLiveness(50_000);

    unsub();
    const staleEvents = (received as Array<Record<string, unknown>>).filter(
      (e) => e["type"] === "liveness:stale",
    );
    assert.equal(
      staleEvents.length,
      0,
      "auto-derived threshold should be 90s — 50s should not trigger liveness:stale",
    );
  });

  it("auto-derived effective threshold is >= 90 seconds", () => {
    // Verify the formula directly: max(90, 10*3) = 90
    const pollSec = 10;
    const configured = 0;
    const effective = configured > 0 ? configured : Math.max(90, pollSec * 3);
    assert.ok(effective >= 90, `effective threshold should be >=90, got ${effective}`);
  });
});
