/**
 * RED tests for S2 — ops event bus (publishOps / subscribeOps).
 * Module does not exist yet — import will throw at runtime → RED.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { publishOps, subscribeOps } from "../src/observability/opsBus.js";

describe("opsBus", () => {
  it("a subscriber receives a published event", () => {
    const received: unknown[] = [];
    const unsub = subscribeOps((e) => received.push(e));

    const event = { type: "error" as const, at: new Date().toISOString(), area: "test", msg: "x" };
    publishOps(event);

    unsub();
    assert.equal(received.length, 1);
    assert.deepEqual(received[0], event);
  });

  it("the returned unsubscribe stops further delivery", () => {
    const received: unknown[] = [];
    const unsub = subscribeOps((e) => received.push(e));

    unsub(); // unsubscribe immediately

    publishOps({ type: "error" as const, at: new Date().toISOString(), area: "test", msg: "after unsub" });

    assert.equal(received.length, 0);
  });

  it("two subscribers both receive an event", () => {
    const a: unknown[] = [];
    const b: unknown[] = [];

    const unsubA = subscribeOps((e) => a.push(e));
    const unsubB = subscribeOps((e) => b.push(e));

    const event = { type: "error" as const, at: new Date().toISOString(), area: "test", msg: "broadcast" };
    publishOps(event);

    unsubA();
    unsubB();

    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.deepEqual(a[0], event);
    assert.deepEqual(b[0], event);
  });

  it("a throwing subscriber does NOT crash publishOps (money-path guard)", () => {
    const good: unknown[] = [];

    // Subscriber that throws — must not propagate
    const unsubBad = subscribeOps((_e) => { throw new Error("subscriber boom"); });
    // Good subscriber must still receive the event
    const unsubGood = subscribeOps((e) => good.push(e));

    const event = { type: "error" as const, at: new Date().toISOString(), area: "test", msg: "safe" };
    // publishOps must not throw even though one subscriber throws
    assert.doesNotThrow(() => publishOps(event));

    unsubBad();
    unsubGood();

    assert.equal(good.length, 1, "good subscriber must still receive the event");
    assert.deepEqual(good[0], event);
  });
});
