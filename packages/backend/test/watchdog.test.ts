/**
 * Tests for S8 — watchdog with a literal stale threshold.
 * Threshold + poll interval are injected as params, so these are deterministic
 * and decoupled from the config singleton: checkLiveness(nowMs, staleSec, pollSec).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { markTick, checkLiveness } from "../src/observability/watchdog.js";
import { subscribeOps } from "../src/observability/opsBus.js";

describe("watchdog — literal threshold (HEARTBEAT_STALE_SEC=2)", () => {
  it("no liveness:stale event when elapsed < threshold", () => {
    const received: unknown[] = [];
    const unsub = subscribeOps((e) => received.push(e));

    markTick(1000);
    // 2500 - 1000 = 1.5s < 2s threshold → no event
    checkLiveness(2500, 2);

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
    // 4000 - 1000 = 3s > 2s threshold → should fire
    checkLiveness(4000, 2);

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
