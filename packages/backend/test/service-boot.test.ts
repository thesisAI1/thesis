/**
 * RED tests for Wave 3 S12 — startService() boot/teardown wiring (AC1).
 *
 * These tests pin that startService() in mock mode (no TELEGRAM_BOT_TOKEN):
 *   1. Returns a function (the stop handle) — not null/undefined/void.
 *   2. Does not throw during startup.
 *   3. Calling the returned stop() does not throw — clean teardown of all
 *      internal intervals/loops including the new notifier/bot/watchdog
 *      loops added by S12.
 *
 * RED phase: once S12 adds the notifier/bot/watchdog wiring inside
 * startService(), these tests should pass (GREEN). They are classified RED
 * because the wiring does not exist yet — if startService() has a bug in the
 * new boot code (throws, returns void, or stop() throws), the tests fail.
 *
 * The test calls stop() immediately to prevent intervals from lingering into
 * subsequent tests (important for the shared-process test runner).
 *
 * DATA DIR ISOLATION:
 *   node --test runs each test file in a worker thread. Multiple workers write
 *   to the same ./data/thesis-data.json.tmp path concurrently → rename race →
 *   ENOENT. We set DATA_DIR to a per-worker temp path BEFORE the config module
 *   loads (dynamic import) to isolate each worker's store.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Isolate the file store to a unique temp directory per worker ─────────────
const workerDataDir = join(tmpdir(), `thesis-test-service-boot-${process.pid}-${Date.now()}`);
mkdirSync(workerDataDir, { recursive: true });
process.env["DATA_DIR"] = workerDataDir;

// Dynamic import — deferred until after env vars are set.
const { startService } = await import("../src/service.js");

// ---------------------------------------------------------------------------
// AC1 — startService() in mock mode with no telegram token
// ---------------------------------------------------------------------------

describe("startService() boot (AC1)", () => {
  it("returns a function (stop handle) and does not throw", () => {
    // No TELEGRAM_BOT_TOKEN is set in test env — service must boot silently
    // and auto-disable the telegram bot.
    let stop: unknown;
    assert.doesNotThrow(() => {
      stop = startService();
    }, "startService() must not throw during startup (mock mode, no telegram token)");

    assert.ok(
      typeof stop === "function",
      `startService() must return a function; got ${typeof stop}`,
    );

    // Call stop() immediately so intervals are cleared before next test runs.
    assert.doesNotThrow(() => {
      (stop as () => void)();
    }, "stop() returned by startService() must not throw");
  });

  it("calling stop() a second time does not throw (idempotent teardown)", () => {
    const stop = startService();

    stop(); // first call — clears intervals
    assert.doesNotThrow(
      () => stop(), // second call — must not error
      "stop() called twice must not throw",
    );
  });
});
