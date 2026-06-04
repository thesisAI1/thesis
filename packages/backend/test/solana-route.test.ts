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
import type { JitoSubmitFailure } from "../src/adapters/chain/jito.js";

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

test("classifyRouteError: parseJupiterQuote 'Jupiter: no route (...)' wording → no_route", () => {
  // parseJupiterQuote (jupiter-parse.ts:46) throws EXACTLY this wording on a no-
  // liquidity quote: `Jupiter: no route (<reason>).`. The old regex only matched
  // "no routes found" / "Jupiter /quote 400" / "COULD_NOT_FIND_ANY_ROUTE", none of
  // which appear in that string — so a genuine mid-ladder no-route rethrew RAW
  // (lost the entry) instead of taking the clean abandon path. Pin the real wording
  // with reasons that do NOT incidentally match the other arms.
  assert.equal(classifyRouteError(new Error("Jupiter: no route (missing outAmount).")), "no_route");
  assert.equal(classifyRouteError(new Error("Jupiter: no route (TOKEN_NOT_TRADABLE).")), "no_route");
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

const fail = (o: Omit<JitoSubmitFailure, "ok">): JitoSubmitFailure => ({ ok: false, ...o } as JitoSubmitFailure);

test("classifySubmitFailure: route_reject (vote-account lock) → reroute", () => {
  assert.equal(classifySubmitFailure(fail({ kind: "route_reject", reason: "jito_http_400 vote" })), "reroute");
});

test("classifySubmitFailure: too_large (Helius Sender size reject) → reroute", () => {
  // jito.ts emits kind too_large for the sender_http_500 "base64 encoded too large":
  // a pre-submission size reject the caller must shrink the route for — never retry
  // or escalate the tip (untreated it retried the SAME oversized tx until it gave up).
  assert.equal(classifySubmitFailure(fail({ kind: "too_large", reason: "sender_http_500 base64 too large" })), "reroute");
});

test("classifySubmitFailure: rate_limit (gateway 429) → rate-limit", () => {
  assert.equal(classifySubmitFailure(fail({ kind: "rate_limit", reason: "jito_http_429" })), "rate-limit");
  // retryAfterMs is carried on this kind (and the type permits it on no other):
  assert.equal(
    classifySubmitFailure(fail({ kind: "rate_limit", reason: "jito_http_429", retryAfterMs: 250 })),
    "rate-limit",
  );
});

test("classifySubmitFailure: transport (ambiguous 5xx / network) → transport (NOT a tip problem)", () => {
  // THE FIX for the 19 sender_http_500s that burned the whole tip ladder. A server
  // 500 / network blip is ambiguous (the tx MIGHT have landed) → confirm-first, do
  // NOT escalate the tip.
  assert.equal(classifySubmitFailure(fail({ kind: "transport", reason: "sender_http_500" })), "transport");
  assert.equal(classifySubmitFailure(fail({ kind: "transport", reason: "fetch failed" })), "transport");
});

test("classifySubmitFailure: abandon (deterministic 4xx / unparseable) → abandon", () => {
  assert.equal(classifySubmitFailure(fail({ kind: "abandon", reason: "jito_http_400" })), "abandon");
});

test("classifySubmitFailure: every failure kind maps to exactly one action (exhaustive)", () => {
  // Replaces the old 'routeReject/tooLarge WITHOUT definitelyNotAccepted → transport'
  // defensive tests. Those pinned a RUNTIME guard against an illegal bool-bag combo
  // (a no-confirm reroute over a possibly-live tx → double-fill). With the kind-union
  // that combo is UNREPRESENTABLE — route_reject/too_large are provably-not-accepted
  // by construction — and the compile-time assertNever in classifySubmitFailure
  // enforces totality. Since the test dir isn't typechecked, this table ALSO pins the
  // full kind→action mapping at runtime (and breaks loudly if a kind is added).
  const table: Record<JitoSubmitFailure["kind"], "reroute" | "rate-limit" | "transport" | "abandon"> = {
    route_reject: "reroute",
    too_large: "reroute",
    rate_limit: "rate-limit",
    transport: "transport",
    abandon: "abandon",
  };
  for (const [kind, action] of Object.entries(table)) {
    assert.equal(
      classifySubmitFailure(fail({ kind: kind as JitoSubmitFailure["kind"], reason: "x" })),
      action,
      `kind ${kind} should map to ${action}`,
    );
  }
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
