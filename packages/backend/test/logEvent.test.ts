/**
 * RED tests for S4 — logEvent() chokepoint in util/log.ts.
 * logEvent does not exist yet — import will throw / be undefined → RED.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { log, logEvent } from "../src/util/log.js";
import { subscribeOps } from "../src/observability/opsBus.js";
import { getEventLog } from "../src/observability/eventLog.js";

describe("logEvent", () => {
  it("logEvent with level=error publishes an ops error event + records to event log", () => {
    const opsReceived: unknown[] = [];
    const unsub = subscribeOps((e) => opsReceived.push(e));

    logEvent({ level: "error", area: "svc", type: "x:failed", msg: "boom" });

    unsub();

    // Check ops bus
    assert.equal(opsReceived.length, 1);
    const opsEvent = opsReceived[0] as Record<string, unknown>;
    assert.equal(opsEvent["type"], "error");
    assert.equal(opsEvent["area"], "svc");
    assert.equal(opsEvent["msg"], "boom");

    // Check event log
    const recent = getEventLog().recent(1);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].msg, "boom");
    assert.equal(recent[0].level, "error");
    assert.equal(recent[0].area, "svc");
  });

  it("logEvent with explicit ops event publishes that exact ops event", () => {
    const opsReceived: unknown[] = [];
    const unsub = subscribeOps((e) => opsReceived.push(e));

    const opsPayload = {
      type: "trade:buy" as const,
      at: new Date().toISOString(),
      positionId: "p1",
      handle: "@a",
      amountEth: 0.1,
      contract: "0xabc",
    };

    logEvent({
      level: "info",
      area: "svc",
      type: "t",
      msg: "m",
      ops: opsPayload,
    });

    unsub();

    assert.equal(opsReceived.length, 1);
    assert.deepEqual(opsReceived[0], opsPayload);
  });

  it("log.info exists and is callable (unchanged API)", () => {
    assert.equal(typeof log.info, "function");
    // Should not throw
    log.info("test info message");
  });

  it("log.warn exists and is callable (unchanged API)", () => {
    assert.equal(typeof log.warn, "function");
    log.warn("test warn message");
  });

  it("log.error exists and is callable (unchanged API)", () => {
    assert.equal(typeof log.error, "function");
    log.error("test error message");
  });
});
