/**
 * The MEV-protected swap LOOP (adapters/chain/solana-route.ts executeProtectedSwap),
 * driven end-to-end with injected fakes — no live RPC / Jupiter / block engine.
 *
 * Each test reproduces a failure mode observed in prod on 2026-06-04 and pins the
 * fix. Against the original inline loop these would FAIL (it threw raw errors /
 * burned the tip ladder); against the extracted loop they PASS.
 *
 * Pure orchestration over injected IO — no store/network, so no isolate-store.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  executeProtectedSwap,
  buildRouteLadder,
  type ProtectedSwapDeps,
  type RouteSpec,
  type SwapAttempt,
} from "../src/adapters/chain/solana-route.js";
import type { JitoSubmit } from "../src/adapters/chain/jito.js";

const FLOOR = { p50: 10_000, p75: 100_000, p95: 1_000_000 };

const BUILT = (sig = "sig1") => ({ signature: sig, blockhash: "bh", lastValidBlockHeight: 100 });

/** An attempt whose submit succeeded (block engine accepted the bundle). */
const okAttempt = (outAmount = "1000", sig = "sig1"): SwapAttempt => ({
  outAmount,
  submit: { ok: true, bundleId: "b1" },
  built: BUILT(sig),
});

/** An attempt whose submit FAILED with the given classification flags. */
const failAttempt = (submit: Partial<Extract<JitoSubmit, { ok: false }>>, sig = "sig1"): SwapAttempt => ({
  outAmount: "1000",
  submit: { ok: false, reason: "x", ...submit },
  built: BUILT(sig),
});

interface Recorder {
  routes: RouteSpec[];
  tips: number[];
  confirms: number;
}

function makeDeps(
  rec: Recorder,
  script: {
    attempt: (call: number, routeSpec: RouteSpec, tip: number) => Promise<SwapAttempt>;
    confirmOrExpire?: (call: number) => Promise<"landed" | "expired">;
    maxAttempts?: number;
    maxTransientRetries?: number;
    tipFloorLamports?: number;
    maxTipLamports?: number;
  },
): ProtectedSwapDeps {
  let attemptCall = 0;
  let confirmCall = 0;
  return {
    floor: FLOOR,
    maxAttempts: script.maxAttempts ?? 8,
    maxTipLamports: script.maxTipLamports ?? 4_000_000,
    maxTransientRetries: script.maxTransientRetries ?? 15,
    tipFloorLamports: script.tipFloorLamports ?? 0,
    routeLadder: buildRouteLadder(64),
    attempt: async (routeSpec, tip) => {
      rec.routes.push(routeSpec);
      rec.tips.push(tip);
      return script.attempt(attemptCall++, routeSpec, tip);
    },
    confirmOrExpire: async () => {
      rec.confirms++;
      const r = script.confirmOrExpire ? await script.confirmOrExpire(confirmCall) : "expired";
      confirmCall++;
      return r;
    },
    sleep: async () => {},
    log: { info: () => {}, warn: () => {} },
  };
}

// --- I1: vote-account reject recovers to a DIRECT route and LANDS -------------

test("vote-lock at the rich route jumps to direct routes and lands (entry saved)", async () => {
  const rec: Recorder = { routes: [], tips: [], confirms: 0 };
  const deps = makeDeps(rec, {
    attempt: async (call) =>
      call === 0
        ? failAttempt({ routeReject: true, retryable: true, definitelyNotAccepted: true, reason: "jito_http_400 vote" })
        : okAttempt("1234", "sigDirect"),
    confirmOrExpire: async () => "landed",
  });

  const res = await executeProtectedSwap(deps);

  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.txHash, "sigDirect");
    assert.equal(res.outAmount, "1234");
  }
  // It jumped STRAIGHT to direct routes (step 3) — NOT maxAccounts 48 (which the
  // old code tried, and which re-hit the vote lock in prod).
  assert.deepEqual(rec.routes[1], { onlyDirectRoutes: true });
  // Same tier throughout — a vote lock never escalates the tip.
  assert.equal(rec.tips[0], rec.tips[1]);
});

// --- I1 (exact prod chain): vote-lock then no direct route → CLEAN abandon ----

test("vote-lock then no direct route abandons cleanly (no raw Jupiter 400 thrown)", async () => {
  const rec: Recorder = { routes: [], tips: [], confirms: 0 };
  const deps = makeDeps(rec, {
    attempt: async (call) => {
      if (call === 0) {
        return failAttempt({ routeReject: true, retryable: true, definitelyNotAccepted: true, reason: "jito_http_400 vote" });
      }
      // Direct-routes re-quote finds NO route — prod threw this raw and LOST the
      // entry. Now it must surface as a clean abandon result.
      throw new Error("Jupiter /quote 400");
    },
  });

  // Must NOT throw — the loop returns an abandon result for the caller to alarm on.
  const res = await executeProtectedSwap(deps);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.reason, /route recovery exhausted \(no_route\)/);
  assert.deepEqual(rec.routes[1], { onlyDirectRoutes: true });
});

// --- I8: a persistent 5xx retries the SAME tier, never escalating the tip -----

test("ambiguous 5xx submit errors retry the same tier (do NOT burn the tip ladder)", async () => {
  const rec: Recorder = { routes: [], tips: [], confirms: 0 };
  const deps = makeDeps(rec, {
    // Every submit is a server 500 (retryable, ambiguous), tx never lands.
    attempt: async () =>
      failAttempt({ reason: "sender_http_500", retryable: true, definitelyNotAccepted: false }),
    confirmOrExpire: async () => "expired",
    maxTransientRetries: 3,
    maxAttempts: 8,
  });

  const res = await executeProtectedSwap(deps);

  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.reason, /transport error.*gave up after 3 retries/);
  // 1 initial + 3 retries = 4 attempts (capped by transientRetries), NOT 8 tiers.
  assert.equal(rec.tips.length, 4);
  // The tip NEVER escalated — a 500 is not "tip too low". (Old code escalated the
  // tier on every 5xx, climbing to the cap and over-tipping for nothing.)
  assert.ok(rec.tips.every((t) => t === rec.tips[0]), `tips should be constant, got ${rec.tips}`);
});

// --- Legit escalation still works: accepted-but-not-landing climbs the ladder -

test("accepted-but-expired (tip too low) DOES escalate the tip across tiers", async () => {
  const rec: Recorder = { routes: [], tips: [], confirms: 0 };
  const deps = makeDeps(rec, {
    attempt: async () => okAttempt(), // accepted every time
    confirmOrExpire: async () => "expired", // but never lands
    maxAttempts: 4,
    maxTipLamports: 100_000_000,
  });

  const res = await executeProtectedSwap(deps);

  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.reason, /bundle expired without landing|tip cap/);
  assert.equal(rec.tips.length, 4); // one per tier
  // Strictly increasing tips: p50 → p75 → p95 → 2×p95.
  for (let i = 1; i < rec.tips.length; i++) {
    assert.ok(rec.tips[i] > rec.tips[i - 1], `tier ${i} tip ${rec.tips[i]} should exceed ${rec.tips[i - 1]}`);
  }
});

// --- I4 regression: a too-large route shrinks then lands ----------------------

test("too-large route shrinks the ladder (same tier) and then lands", async () => {
  const rec: Recorder = { routes: [], tips: [], confirms: 0 };
  const deps = makeDeps(rec, {
    attempt: async (call) => {
      if (call === 0) throw new RangeError("encoding overruns Uint8Array");
      return okAttempt("777", "sigShrunk");
    },
    confirmOrExpire: async () => "landed",
  });

  const res = await executeProtectedSwap(deps);

  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.txHash, "sigShrunk");
  // Stepped ONE rung down (64 → 48), same tier.
  assert.deepEqual(rec.routes[1], { maxAccounts: 48 });
  assert.equal(rec.tips[0], rec.tips[1]);
});

// --- I2: too-large at EVERY route → clean abandon (no raw RangeError thrown) ---

test("too-large at every route step abandons cleanly (no raw RangeError thrown)", async () => {
  const rec: Recorder = { routes: [], tips: [], confirms: 0 };
  const deps = makeDeps(rec, {
    attempt: async () => {
      throw new RangeError("encoding overruns Uint8Array");
    },
  });

  const res = await executeProtectedSwap(deps); // must NOT throw
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.reason, /route recovery exhausted \(too_large\)/);
  // Walked the whole ladder: 64 → 48 → 32 → direct (4 quotes), then abandoned.
  assert.equal(rec.routes.length, 4);
  assert.deepEqual(rec.routes[3], { onlyDirectRoutes: true });
});

// --- Edge: a genuine no-route at the HAPPY path propagates (no liquidity) ------

test("no-route at the happy path (step 0) propagates — not silently abandoned", async () => {
  const rec: Recorder = { routes: [], tips: [], confirms: 0 };
  const deps = makeDeps(rec, {
    attempt: async () => {
      throw new Error("Jupiter /quote 400");
    },
  });
  // We did NOT constrain the route — a 400 here means the token has no liquidity
  // at all. That must surface as a real error, not a masked "abandon".
  await assert.rejects(() => executeProtectedSwap(deps), /Jupiter \/quote 400/);
  assert.equal(rec.routes.length, 1); // never entered route recovery
});

// --- Double-fill guards preserved --------------------------------------------

test("429 retries the same tier WITHOUT a confirm (provably not accepted)", async () => {
  const rec: Recorder = { routes: [], tips: [], confirms: 0 };
  const deps = makeDeps(rec, {
    attempt: async (call) =>
      call === 0
        ? failAttempt({ reason: "jito_http_429", retryable: true, definitelyNotAccepted: true, retryAfterMs: 1 })
        : okAttempt("1", "sigOk"),
    confirmOrExpire: async () => "landed",
  });

  const res = await executeProtectedSwap(deps);

  assert.equal(res.ok, true);
  // Only ONE confirm — for the landed tx. The 429 attempt is dead-on-arrival, so
  // it is rebuilt WITHOUT a confirm (no double-fill risk, no wasted RPC).
  assert.equal(rec.confirms, 1);
  assert.equal(rec.tips[0], rec.tips[1]); // same tier
});

test("deterministic reject (non-retryable 4xx) confirms then abandons cleanly", async () => {
  const rec: Recorder = { routes: [], tips: [], confirms: 0 };
  const deps = makeDeps(rec, {
    // A deterministic 4xx (e.g. malformed) — retrying/escalating can't help, but
    // the tx might have been sent, so confirm before giving up.
    attempt: async () => failAttempt({ reason: "jito_http_400", retryable: false }),
    confirmOrExpire: async () => "expired",
  });

  const res = await executeProtectedSwap(deps);

  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.reason, /jito submit rejected \(jito_http_400\)/);
  assert.equal(rec.confirms, 1); // confirmed-before-abandon (no blind give-up)
  assert.equal(rec.routes.length, 1); // did not rebuild over a possibly-live tx
});

test("tip-cap early-exit: a tier at the cap that won't land abandons with 'tip cap'", async () => {
  const rec: Recorder = { routes: [], tips: [], confirms: 0 };
  const deps = makeDeps(rec, {
    attempt: async () => okAttempt(), // accepted every time
    confirmOrExpire: async () => "expired", // but never lands
    maxAttempts: 8,
    // Cap is below the very first ladder rung (p50=10_000), so tier 0's tip is
    // already pinned at the cap → after the first non-landing it must abandon.
    maxTipLamports: 5_000,
  });

  const res = await executeProtectedSwap(deps);

  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.reason, /tip cap 5000 lamports reached/);
  assert.equal(rec.tips.length, 1); // stopped at the cap, did not burn 8 tiers
  assert.equal(rec.tips[0], 5_000); // clamped to the cap
});

test("a 5xx whose tx actually LANDED returns success (confirm-before-rebuild)", async () => {
  const rec: Recorder = { routes: [], tips: [], confirms: 0 };
  const deps = makeDeps(rec, {
    // Ambiguous 500, but the bundle DID land — must be detected, not rebuilt over.
    attempt: async () => failAttempt({ reason: "sender_http_500", retryable: true, definitelyNotAccepted: false }, "sigLanded"),
    confirmOrExpire: async () => "landed",
  });

  const res = await executeProtectedSwap(deps);

  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.txHash, "sigLanded");
  assert.equal(rec.routes.length, 1); // did NOT rebuild over a possibly-live tx
});
