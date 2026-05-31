/**
 * PR2 — async mutex (store/lock.ts).
 *
 * Proves the lock serializes critical sections that interleave on awaits, and
 * that a rejection in one section does not poison the lock for the next.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { withLock } from "../src/store/lock.js";

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

test("withLock serializes a read-modify-write that would otherwise lose updates", async () => {
  // Shared mutable state with an await between read and write — the classic
  // lost-update shape. Without the lock, two concurrent runs both read 0 and
  // both write 1 (final = 1). With the lock they serialize (final = 2).
  const state = { value: 0 };
  async function unsafeIncrement(): Promise<void> {
    const seen = state.value; // read
    await tick(); // yield — a competitor can run here
    state.value = seen + 1; // write
  }

  await Promise.all([
    withLock(() => unsafeIncrement()),
    withLock(() => unsafeIncrement()),
  ]);

  assert.equal(state.value, 2, "both increments must be applied (no lost update)");
});

test("withLock runs sections in FIFO order", async () => {
  const order: number[] = [];
  await Promise.all([
    withLock(async () => { await tick(); order.push(1); }),
    withLock(async () => { order.push(2); }),
    withLock(async () => { await tick(); order.push(3); }),
  ]);
  assert.deepEqual(order, [1, 2, 3], "sections run in the order they were queued");
});

test("a rejected section does not poison the lock", async () => {
  await assert.rejects(withLock(async () => { throw new Error("boom"); }));
  // The next caller must still run normally.
  const v = await withLock(async () => 42);
  assert.equal(v, 42);
});

test("the caller receives the section's real return value", async () => {
  const v = await withLock(async () => {
    await tick();
    return "result";
  });
  assert.equal(v, "result");
});
