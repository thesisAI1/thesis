/**
 * Pure route-shaping + failure-classification helpers (adapters/chain/solana-route.ts).
 *
 * These pin the recovery DECISIONS that, in the original inline loop, lost live
 * Solana entries on 2026-06-04:
 *   - a Jito "cannot lock any vote accounts" reject was recovered by shrinking
 *     maxAccounts (which does NOT change the DEX), so the constrained re-quote
 *     threw a raw `Jupiter /quote 400` and the buy was lost;
 *   - an ambiguous 5xx submit error escalated the tip tier, burning the ladder on
 *     a transport problem a bigger tip can't fix.
 *
 * Pure functions, no store/RPC — no isolate-store needed (mirrors jito.test.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRouteError,
  planRouteRecovery,
  classifySubmitFailure,
  buildRouteLadder,
  transientBackoffMs,
  describeRoute,
} from "../src/adapters/chain/solana-route.js";
import type { JitoSubmit } from "../src/adapters/chain/jito.js";

// --- classifyRouteError -------------------------------------------------------

test("classifyRouteError: versioned-tx serialize overrun → too_large", () => {
  assert.equal(classifyRouteError(new RangeError("encoding overruns Uint8Array")), "too_large");
});

test("classifyRouteError: legacy 'Transaction too large' → too_large", () => {
  assert.equal(classifyRouteError(new Error("Transaction too large: 1300 > 1232")), "too_large");
});

test("classifyRouteError: Jupiter 400 (no route at constraint) → no_route", () => {
  assert.equal(classifyRouteError(new Error("Jupiter /quote 400")), "no_route");
  assert.equal(classifyRouteError(new Error("COULD_NOT_FIND_ANY_ROUTE")), "no_route");
});

test("classifyRouteError: a 5xx / unrelated error is NOT route-shaped → null", () => {
  // A real RPC/Jupiter outage must NOT be misread as a route problem (it would
  // wrongly trigger the shrink ladder instead of propagating).
  assert.equal(classifyRouteError(new Error("Jupiter /quote 500")), null);
  assert.equal(classifyRouteError(new Error("fetch failed")), null);
});

// --- planRouteRecovery (4-step ladder: 64 → 48 → 32 → direct) -----------------

test("planRouteRecovery: vote_lock JUMPS straight to the direct-routes step", () => {
  // THE FIX. maxAccounts 48/32 don't change which DEX Jupiter picks, so a
  // vote-locking multi-hop route keeps getting re-selected (it did in prod).
  // Jump to the last (direct) step, which forces a single-hop route.
  assert.deepEqual(planRouteRecovery(4, 0, "vote_lock"), { step: 3 });
  assert.deepEqual(planRouteRecovery(4, 1, "vote_lock"), { step: 3 });
  assert.deepEqual(planRouteRecovery(4, 2, "vote_lock"), { step: 3 });
});

test("planRouteRecovery: vote_lock with no simpler route left → abandon (null)", () => {
  // Already on direct routes and STILL vote-locking → a tip can't help; abandon
  // cleanly rather than thrash. (Old code threw a raw Jupiter 400 here instead.)
  assert.equal(planRouteRecovery(4, 3, "vote_lock"), null);
});

test("planRouteRecovery: too_large / no_route step ONE rung down", () => {
  assert.deepEqual(planRouteRecovery(4, 0, "too_large"), { step: 1 });
  assert.deepEqual(planRouteRecovery(4, 2, "too_large"), { step: 3 });
  assert.deepEqual(planRouteRecovery(4, 1, "no_route"), { step: 2 });
});

test("planRouteRecovery: too_large / no_route at the last step → abandon (null)", () => {
  assert.equal(planRouteRecovery(4, 3, "too_large"), null);
  assert.equal(planRouteRecovery(4, 3, "no_route"), null);
});

// --- classifySubmitFailure ----------------------------------------------------

const fail = (o: Partial<Extract<JitoSubmit, { ok: false }>>): Extract<JitoSubmit, { ok: false }> => ({
  ok: false,
  reason: "x",
  ...o,
});

test("classifySubmitFailure: vote-account reject → reroute", () => {
  assert.equal(
    classifySubmitFailure(fail({ routeReject: true, retryable: true, definitelyNotAccepted: true })),
    "reroute",
  );
});

test("classifySubmitFailure: 429 (definitely not accepted) → rate-limit", () => {
  assert.equal(
    classifySubmitFailure(fail({ reason: "jito_http_429", retryable: true, definitelyNotAccepted: true })),
    "rate-limit",
  );
});

test("classifySubmitFailure: ambiguous 5xx / network → transport (NOT a tip problem)", () => {
  // THE FIX for the 19 sender_http_500s that burned the whole tip ladder. A
  // server 500 is retryable but NOT definitely-not-accepted → transport.
  assert.equal(
    classifySubmitFailure(fail({ reason: "sender_http_500", retryable: true, definitelyNotAccepted: false })),
    "transport",
  );
  assert.equal(
    classifySubmitFailure(fail({ reason: "fetch failed", retryable: true, definitelyNotAccepted: false })),
    "transport",
  );
});

test("classifySubmitFailure: deterministic 4xx (not retryable) → abandon", () => {
  assert.equal(classifySubmitFailure(fail({ reason: "jito_http_400", retryable: false })), "abandon");
});

test("classifySubmitFailure: routeReject WITHOUT definitelyNotAccepted does NOT fast-path reroute", () => {
  // Defensive: a reroute rebuilds without a confirm, only safe when the bundle
  // provably never entered the engine. Absent that flag, it must fall through to
  // a confirm-first path (transport here), never the no-confirm reroute.
  assert.equal(
    classifySubmitFailure(fail({ routeReject: true, retryable: true, definitelyNotAccepted: false })),
    "transport",
  );
});

// --- buildRouteLadder / describeRoute / transientBackoffMs --------------------

test("buildRouteLadder: rich → 48 → 32 → direct-routes-only", () => {
  assert.deepEqual(buildRouteLadder(64), [
    { maxAccounts: 64 },
    { maxAccounts: 48 },
    { maxAccounts: 32 },
    { onlyDirectRoutes: true },
  ]);
});

test("describeRoute: human labels for log lines", () => {
  assert.equal(describeRoute({ maxAccounts: 48 }), "maxAccounts=48");
  assert.equal(describeRoute({ onlyDirectRoutes: true }), "direct-routes-only");
});

test("transientBackoffMs: exponential, capped at 5s", () => {
  assert.equal(transientBackoffMs(1), 400);
  assert.equal(transientBackoffMs(2), 800);
  assert.equal(transientBackoffMs(3), 1_600);
  assert.equal(transientBackoffMs(10), 5_000); // capped
});
