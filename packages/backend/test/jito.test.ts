/**
 * Pure Jito MEV helpers (adapters/chain/jito.ts).
 *
 * Like jupiter-parse, these are pure functions unit-tested without a live RPC or
 * the block engine. They pin the money-critical decisions: the escalating tip
 * ladder (start low → bid higher → clamp to the cap), the tip-floor parser, and
 * the sendBundle request/response shapes.
 *
 * Regression guard: the logic was authored in this session, so these are
 * GREEN-on-arrival (no flippable RED) — they exist to catch silent breakage of
 * the tip schedule or the Jito wire format.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tipForAttempt,
  parseTipFloor,
  buildSendBundleBody,
  buildSenderSendTxBody,
  parseSendBundleResponse,
  isTooLargeReason,
  SAFE_DEFAULT_TIP_FLOOR,
  MIN_TIP_LAMPORTS,
  type TipFloorLamports,
} from "../src/adapters/chain/jito.js";

const FLOOR: TipFloorLamports = { p50: 10_000, p75: 100_000, p95: 1_000_000 };

// --- tipForAttempt: the escalation ladder -------------------------------------

test("tipForAttempt: attempt 0/1/2 walk the p50→p75→p95 ladder", () => {
  const max = 100_000_000;
  assert.equal(tipForAttempt(FLOOR, 0, { maxLamports: max }), 10_000); // p50
  assert.equal(tipForAttempt(FLOOR, 1, { maxLamports: max }), 100_000); // p75
  assert.equal(tipForAttempt(FLOOR, 2, { maxLamports: max }), 1_000_000); // p95
});

test("tipForAttempt: beyond the ladder it doubles p95 each step", () => {
  const max = 100_000_000;
  assert.equal(tipForAttempt(FLOOR, 3, { maxLamports: max }), 2_000_000); // p95 * 2^1
  assert.equal(tipForAttempt(FLOOR, 4, { maxLamports: max }), 4_000_000); // p95 * 2^2
});

test("tipForAttempt: escalation is monotonic non-decreasing", () => {
  const max = 100_000_000;
  let prev = -1;
  for (let a = 0; a < 8; a++) {
    const tip = tipForAttempt(FLOOR, a, { maxLamports: max });
    assert.ok(tip >= prev, `attempt ${a} tip ${tip} < previous ${prev}`);
    prev = tip;
  }
});

test("tipForAttempt: the hard cap always wins (never overpays)", () => {
  const cap = 250_000;
  // p95 (1_000_000) and all higher rungs exceed the cap → clamped to cap.
  assert.equal(tipForAttempt(FLOOR, 2, { maxLamports: cap }), cap);
  assert.equal(tipForAttempt(FLOOR, 5, { maxLamports: cap }), cap);
});

test("tipForAttempt: never tips below MIN_TIP_LAMPORTS (un-landable)", () => {
  const tinyFloor: TipFloorLamports = { p50: 1, p75: 2, p95: 3 };
  const tip = tipForAttempt(tinyFloor, 0, { maxLamports: 100_000_000 });
  assert.equal(tip, MIN_TIP_LAMPORTS);
});

test("tipForAttempt: null floor ladders off SAFE_DEFAULT_TIP_FLOOR", () => {
  const max = 100_000_000;
  assert.equal(
    tipForAttempt(null, 0, { maxLamports: max }),
    SAFE_DEFAULT_TIP_FLOOR.p50,
  );
  assert.equal(
    tipForAttempt(null, 2, { maxLamports: max }),
    SAFE_DEFAULT_TIP_FLOOR.p95,
  );
});

test("tipForAttempt: returns integer lamports", () => {
  const oddFloor: TipFloorLamports = { p50: 10_001, p75: 33_333, p95: 99_999 };
  for (let a = 0; a < 5; a++) {
    const tip = tipForAttempt(oddFloor, a, { maxLamports: 100_000_000 });
    assert.equal(tip, Math.round(tip), `attempt ${a} tip not an integer`);
  }
});

// --- parseTipFloor: SOL floats → integer lamports -----------------------------

test("parseTipFloor: converts the first item's SOL percentiles to lamports", () => {
  const json = [
    {
      landed_tips_50th_percentile: 0.00001, // 10_000 lamports
      landed_tips_75th_percentile: 0.0001, // 100_000
      landed_tips_95th_percentile: 0.001, // 1_000_000
    },
  ];
  assert.deepEqual(parseTipFloor(json), { p50: 10_000, p75: 100_000, p95: 1_000_000 });
});

test("parseTipFloor: returns null on non-array / empty / bad shape", () => {
  assert.equal(parseTipFloor(null), null);
  assert.equal(parseTipFloor([]), null);
  assert.equal(parseTipFloor({ landed_tips_50th_percentile: 0.0001 }), null);
  assert.equal(
    parseTipFloor([{ landed_tips_50th_percentile: "x", landed_tips_75th_percentile: 1, landed_tips_95th_percentile: 1 }]),
    null,
  );
});

// --- sendBundle wire format ---------------------------------------------------

test("buildSendBundleBody: valid JSON-RPC sendBundle with a single-tx bundle", () => {
  const body = JSON.parse(buildSendBundleBody("BASE58TX"));
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.method, "sendBundle");
  assert.deepEqual(body.params, [["BASE58TX"]]);
});

test("buildSenderSendTxBody: base64 sendTransaction with skipPreflight + no retries", () => {
  const body = JSON.parse(buildSenderSendTxBody("BASE64TX"));
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.method, "sendTransaction");
  assert.deepEqual(body.params, [
    "BASE64TX",
    { encoding: "base64", skipPreflight: true, maxRetries: 0 },
  ]);
});

test("parseSendBundleResponse: result → ok with bundleId", () => {
  assert.deepEqual(parseSendBundleResponse({ result: "bundle123" }), {
    ok: true,
    bundleId: "bundle123",
  });
});

test("parseSendBundleResponse: error → not-ok with the rpc message", () => {
  const r = parseSendBundleResponse({ error: { message: "rate limited" } });
  assert.deepEqual(r, { ok: false, reason: "rate limited" });
});

test("parseSendBundleResponse: missing result / malformed → not-ok", () => {
  assert.deepEqual(parseSendBundleResponse({}), { ok: false, reason: "missing_bundle_id" });
  assert.deepEqual(parseSendBundleResponse(null), { ok: false, reason: "malformed_response" });
});

// --- isTooLargeReason: "tx too big to land" classifier -------------------------
// A swap whose Jupiter route is too complex to fit one 1232-byte Solana packet
// cannot land no matter the tip — only a SIMPLER route can fix it. This shows up
// as THREE different strings depending on where the size limit bites; all three
// must be recognised so protectedSwap shrinks the route instead of escalating the
// tip. The Helius-Sender form ("base64 encoded too large", inside a -32602 body)
// was UNRECOGNISED in prod (2026-06-04) → every sender-mode buy burned its whole
// tip ladder and abandoned. RED until isTooLargeReason exists.

test("isTooLargeReason: recognises the Helius Sender size reject", () => {
  assert.equal(
    isTooLargeReason('-32602 ... "Invalid Request: base64 encoded too large", data: None'),
    true,
  );
});

test("isTooLargeReason: recognises the local serialize overruns + legacy too-large", () => {
  assert.equal(isTooLargeReason("RangeError: encoding overruns Uint8Array"), true);
  assert.equal(isTooLargeReason("Transaction too large: 1304 > 1232"), true);
});

test("isTooLargeReason: does NOT match tip/rate/route-content failures", () => {
  assert.equal(isTooLargeReason("jito_http_429 — rate limited"), false);
  assert.equal(isTooLargeReason("bundles cannot lock any vote accounts"), false);
  assert.equal(isTooLargeReason("bundle expired without landing at tip 50000"), false);
  assert.equal(isTooLargeReason(""), false);
});
