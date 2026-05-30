/**
 * F4 — holder snapshot staleness ceiling.
 *
 * Unit-tests the pure helper `isSnapshotWithinStaleCeiling` which guards
 * `getEligibleHolders` against serving a frozen, possibly-ineligible holder
 * set when the holder API has been down for longer than STALE_TTL_MULTIPLE TTLs.
 *
 * No network or store access required — the helper is purely computational.
 */

import "./helpers/isolate-store.js"; // MUST be first
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSnapshotWithinStaleCeiling } from "../src/holders/index.js";

// Match the constant in the production module (6 × TTL).
const STALE_TTL_MULTIPLE = 6;

// --- pure helper unit tests --------------------------------------------------

test("isSnapshotWithinStaleCeiling: fresh snapshot (just fetched) → true", () => {
  const now = Date.now();
  const ttlMs = 60 * 60 * 1000; // 60 minutes
  assert.equal(
    isSnapshotWithinStaleCeiling(10, now, now, ttlMs),
    true,
    "a snapshot fetched at 'now' is within ceiling",
  );
});

test("isSnapshotWithinStaleCeiling: snapshot just under the ceiling → true", () => {
  const ttlMs = 60 * 60 * 1000; // 60 min
  const now = Date.now();
  // Age = MULTIPLE * TTL - 1 ms — still within ceiling.
  const fetchedAt = now - (STALE_TTL_MULTIPLE * ttlMs - 1);
  assert.equal(
    isSnapshotWithinStaleCeiling(5, fetchedAt, now, ttlMs),
    true,
    "1 ms before the ceiling edge must still be within ceiling",
  );
});

test("isSnapshotWithinStaleCeiling: snapshot exactly at the ceiling → true", () => {
  const ttlMs = 60 * 60 * 1000;
  const now = Date.now();
  const fetchedAt = now - STALE_TTL_MULTIPLE * ttlMs;
  assert.equal(
    isSnapshotWithinStaleCeiling(5, fetchedAt, now, ttlMs),
    true,
    "snapshot at exactly the ceiling boundary must be within ceiling",
  );
});

test("isSnapshotWithinStaleCeiling: snapshot 1 ms past the ceiling → false", () => {
  const ttlMs = 60 * 60 * 1000;
  const now = Date.now();
  const fetchedAt = now - (STALE_TTL_MULTIPLE * ttlMs + 1);
  assert.equal(
    isSnapshotWithinStaleCeiling(5, fetchedAt, now, ttlMs),
    false,
    "1 ms past the ceiling must be outside ceiling",
  );
});

test("isSnapshotWithinStaleCeiling: very old snapshot → false", () => {
  const ttlMs = 60 * 60 * 1000;
  const now = Date.now();
  // 24 hours old — way past 6× 60-min ceiling.
  const fetchedAt = now - 24 * 60 * 60 * 1000;
  assert.equal(
    isSnapshotWithinStaleCeiling(50, fetchedAt, now, ttlMs),
    false,
    "a 24-hour-old snapshot must be outside ceiling",
  );
});

test("isSnapshotWithinStaleCeiling: empty cache (length 0) → false regardless of age", () => {
  const now = Date.now();
  const ttlMs = 60 * 60 * 1000;
  // Even if "fetched at now", length 0 means nothing to serve.
  assert.equal(
    isSnapshotWithinStaleCeiling(0, now, now, ttlMs),
    false,
    "empty cache must always return false",
  );
});

test("isSnapshotWithinStaleCeiling: empty cache with very old fetchedAt → false", () => {
  const now = Date.now();
  const ttlMs = 60 * 60 * 1000;
  assert.equal(
    isSnapshotWithinStaleCeiling(0, 0, now, ttlMs),
    false,
    "empty cache with epoch fetchedAt must return false",
  );
});

test("isSnapshotWithinStaleCeiling: 1-element cache within ceiling → true", () => {
  const now = Date.now();
  const ttlMs = 30 * 60 * 1000; // 30-min TTL variant
  const fetchedAt = now - ttlMs; // 1× TTL old — well within 6× ceiling
  assert.equal(
    isSnapshotWithinStaleCeiling(1, fetchedAt, now, ttlMs),
    true,
    "single-entry cache within ceiling is valid",
  );
});
