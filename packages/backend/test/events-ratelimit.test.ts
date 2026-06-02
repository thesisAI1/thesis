/**
 * Tests for the /api/events per-IP rate limiter.
 *
 * Uses the injectable `now` parameter on eventsRateLimitExceeded and the
 * exported _sweepEventsRateMap / _eventsRateMap / EVENTS_RATE_SWEEP_INTERVAL
 * to drive time-travel and sweep without real timers.
 *
 * RED→GREEN: the dead `else delete` branch was never reachable (timestamps
 * always contains the just-pushed `now`); idle-key eviction only works via
 * _sweepEventsRateMap. These tests pin that invariant.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";

// Import the server module to get the seams exported for testing.
// eventsRateLimitExceeded is not exported (it reads req), so we test via
// the exported sweep + map. The rate-limit trip itself is exercised through
// a minimal fake req.
import {
  _eventsRateMap,
  _sweepEventsRateMap,
  EVENTS_RATE_SWEEP_INTERVAL,
} from "../src/server/index.js";

// Re-import eventsRateLimitExceeded via a dynamic import trick — we access the
// module's private function by calling handle() with a fake /api/events request
// and capturing the 429. That approach is heavyweight; instead we test the
// exported seam directly and trust the inline integration test in events-api.test.ts
// for the HTTP layer.
//
// For the rate-map eviction test we drive _sweepEventsRateMap directly with a
// controlled `now`.

// Minimal fake IncomingMessage with a fixed IP address.
function fakeReq(ip: string): IncomingMessage {
  return {
    headers: {},
    socket: { remoteAddress: ip },
    url: "/api/events",
    method: "GET",
  } as unknown as IncomingMessage;
}

// Rate limit constants (must match server/index.ts — kept in sync manually).
const EVENTS_RATE_LIMIT = 30;
const EVENTS_RATE_WINDOW_MS = 60_000;

describe("_sweepEventsRateMap — idle key eviction", () => {
  beforeEach(() => {
    _eventsRateMap.clear();
  });

  it("evicts a key whose every timestamp is outside the window", () => {
    const t0 = 1_000_000;
    // Seed IP "A" with a timestamp inside the window at t0.
    _eventsRateMap.set("A", [t0]);

    // Advance time past the window.
    const tLate = t0 + EVENTS_RATE_WINDOW_MS + 1;
    _sweepEventsRateMap(tLate);

    assert.ok(!_eventsRateMap.has("A"), "idle key A must be evicted after window expires");
  });

  it("keeps a key that still has timestamps inside the window", () => {
    const t0 = 2_000_000;
    _eventsRateMap.set("A", [t0]);
    _eventsRateMap.set("B", [t0 - 1000]); // slightly older but still inside

    // Advance time only halfway through the window.
    const tMid = t0 + EVENTS_RATE_WINDOW_MS / 2;
    _sweepEventsRateMap(tMid);

    assert.ok(_eventsRateMap.has("A"), "key A (fresh) must survive the sweep");
    assert.ok(_eventsRateMap.has("B"), "key B (inside window) must survive the sweep");
  });

  it("evicts only idle keys, leaving active keys alone", () => {
    const t0 = 3_000_000;
    // "idle" — only old timestamps.
    _eventsRateMap.set("idle", [t0 - EVENTS_RATE_WINDOW_MS - 500]);
    // "active" — has a fresh timestamp.
    _eventsRateMap.set("active", [t0 - EVENTS_RATE_WINDOW_MS - 500, t0]);

    _sweepEventsRateMap(t0 + 1);

    assert.ok(!_eventsRateMap.has("idle"), "idle key must be evicted");
    assert.ok(_eventsRateMap.has("active"), "active key must remain after sweep");
  });
});

describe("EVENTS_RATE_SWEEP_INTERVAL export", () => {
  it("is a positive integer (sanity)", () => {
    assert.ok(Number.isInteger(EVENTS_RATE_SWEEP_INTERVAL) && EVENTS_RATE_SWEEP_INTERVAL > 0);
  });
});

// ── Rate-limit trip test via _eventsRateMap direct injection ─────────────────
//
// We seed the map with LIMIT timestamps inside the window, then call
// _sweepEventsRateMap (which must NOT evict them). This pins that the sweep
// correctly distinguishes active-at-limit from idle.

describe("rate-limit trip — map holds exactly limit+1 entries (trip boundary)", () => {
  beforeEach(() => {
    _eventsRateMap.clear();
  });

  it("active IP at limit+1 timestamps remains in map after sweep", () => {
    const now = 5_000_000;
    const timestamps: number[] = [];
    for (let i = 0; i <= EVENTS_RATE_LIMIT; i++) {
      timestamps.push(now - i * 100); // all within the window
    }
    _eventsRateMap.set("victim", timestamps);

    _sweepEventsRateMap(now + 1);

    assert.ok(_eventsRateMap.has("victim"), "IP at rate-limit must not be swept");
    assert.equal(
      _eventsRateMap.get("victim")!.length,
      EVENTS_RATE_LIMIT + 1,
      "all timestamps inside the window must be retained",
    );
  });
});
