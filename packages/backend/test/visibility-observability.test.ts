/**
 * TDD RED — P2 operational-visibility gaps (G12a, G14, G15).
 *
 * These tests assert that the relevant failure paths write a structured entry
 * into getEventLog() (and for G12a an ops event is published). Currently they
 * do not — the production code uses plain log.error / log.warn which writes
 * only to stdout, not to the structured event log. All cases below must FAIL
 * (RED) until the corresponding src changes land.
 *
 * G12a  — holder enumeration hard-fail (stale ceiling exceeded) → error ops +
 *          event-log entry. Currently: log.error only.
 * G14   — closeByAuthor throws (DEX routes exhausted) → event-log warn entry
 *          in area "author-close". Currently: log.warn only.
 * G15   — LLM call fails in dean review committee → event-log warn entry.
 *          Currently: log.warn only.
 */

import "./helpers/isolate-store.js"; // MUST be first — temp DATA_DIR + mock mode
import { test } from "node:test";
import assert from "node:assert/strict";

import { getEventLog } from "../src/observability/eventLog.js";
import { subscribeOps, type OpsEvent } from "../src/observability/opsBus.js";
import { getEligibleHolders } from "../src/holders/index.js";
import { runDean } from "../src/agents/dean.js";
import { config } from "../src/config.js";
import type { AuthorReport, Submission, TokenReport } from "@thesis/shared";

// ── G12a — holder enumeration hard-fail → error ops + event-log entry ────────
//
// When the snapshot cache is empty (initial state in mock mode, or after an
// API outage) getEligibleHolders() hits the staleness ceiling:
//   isSnapshotWithinStaleCeiling(0, 0, now, ttl) → false → log.error (today)
//
// Expected (post-fix): logEvent({level:"error", area:"holders",
//   type:"holder-enum:failed", ops:{type:"error", ...}})
//
// Driven by calling getEligibleHolders() in mock mode where fetchHoldersSnapshot
// returns [] early (no key/token set) — no external network call required.

test("G12a: holder enum hard-fail → logEvent error + ops event published", async () => {
  // Collect ops events published during this test.
  const opsReceived: OpsEvent[] = [];
  const unsub = subscribeOps((e) => opsReceived.push(e));

  // Snapshot the event log before the call.
  const before = getEventLog().recent(50).length;

  try {
    // In mock mode (no GOLDRUSH_API_KEY / THESIS_TOKEN_ADDRESS) fetchHoldersSnapshot
    // returns [] without throwing, so _snapshotCache stays empty.  The staleness
    // ceiling check (isSnapshotWithinStaleCeiling(0, …) → false) hits log.error.
    // Post-fix it must call logEvent instead, which writes to the event log.
    await getEligibleHolders();
  } finally {
    unsub();
  }

  const after = getEventLog().recent(50);
  const newEntries = after.slice(0, after.length - before);

  const errEntry = newEntries.find(
    (e) => e.level === "error" && e.area === "holders",
  );
  assert.ok(
    errEntry,
    "expected an event-log error entry with area='holders' after a stale-ceiling hard-fail — got none (RED: log.error does not write to event log)",
  );

  const errOps = opsReceived.find((e) => e.type === "error");
  assert.ok(
    errOps,
    "expected an ops event (type='error') after holder enum hard-fail — got none (RED: no logEvent with ops)",
  );
});

// ── G14 — closeByAuthor failure → event-log warn in area "author-close" ───────
//
// When closeByAuthor() throws (DEX routes exhausted, ~90s retries), the catch in
// handleCloseRequest logs log.warn. Post-fix it must call logEvent so the event
// log captures the failure.
//
// HONEST GAP: closeByAuthor is called inside handleCloseRequest (not exported);
// the only entry point is processAuthorCloseRequests.  Making closeByAuthor
// actually throw requires the mock chain adapter's sell() to throw, which can't
// be done without either src scaffolding (injectable error) or replacing the
// createChainAdapter factory (ESM module — not replaceable without vi.mock in
// vitest, which this suite does not use).  The existing author-close harness
// does not have this infrastructure.
//
// Skipped as an honest gap — the fix is straightforward (replace log.warn with
// logEvent in author-actions.ts:204) but the RED test cannot be written without
// a mockable seam.

test.skip("G14: closeByAuthor throws → logEvent warn in area 'author-close' (honest gap: no injectable error seam in mock chain sell)", async () => {
  // Placeholder: post-fix assertion would be:
  //   const entry = getEventLog().recent(1).find(e => e.area === "author-close" && e.level === "warn");
  //   assert.ok(entry);
});

// ── G15 — LLM call failure in dean → event-log warn entry ────────────────────
//
// When the Anthropic API call inside runDean throws, the catch block calls
// log.warn (currently). Post-fix it must call logEvent so the event log records
// the degradation.
//
// Driven via the same fetch-throw pattern used in dean-llm-fallback.test.ts.

async function withDeanFetchThrowing(fn: () => Promise<void>): Promise<void> {
  const realFetch = globalThis.fetch;
  const realKey = config.llm.anthropicKey;
  config.llm.anthropicKey = "test-key-set"; // key IS set → outage path, not no-key path
  globalThis.fetch = (async () => {
    throw new Error("simulated LLM outage");
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = realFetch;
    config.llm.anthropicKey = realKey;
  }
}

function deanSubmission(): Submission {
  return {
    postId: "post-g15",
    authorXId: "333",
    authorHandle: "@g15user",
    thesisText: "Good project with solid fundamentals.",
    contractAddress: "0x1234567890123456789012345678901234560099",
    chain: "base",
    postUrl: "https://x.com/g15user/status/1",
    postedAt: new Date().toISOString(),
  };
}

function deanAuthorReport(): AuthorReport {
  return {
    authorXId: "333",
    score: 70,
    isLikelyBot: false,
    accountAgeDays: 250,
    smartFollowerCount: 30,
    pastContracts: [],
    pastHitRate: 0.2,
    flags: [],
    reasoning: [],
  };
}

function deanTokenReport(): TokenReport {
  return {
    contractAddress: "0x1234567890123456789012345678901234560099",
    chain: "base",
    score: 75,
    launchpad: "clanker",
    liquidityUsd: 35000,
    marketCapUsd: 350000,
    launchedAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
    top10Concentration: 0.25,
    topHolders: [],
    isHoneypot: false,
    flags: [],
    reasoning: [],
  };
}

test("G15: dean LLM fetch-throw → logEvent warn in event log", async () => {
  // Snapshot before.
  const before = getEventLog().recent(100).length;

  await withDeanFetchThrowing(async () => {
    await runDean(deanSubmission(), deanAuthorReport(), deanTokenReport());
  });

  const after = getEventLog().recent(100);
  const newEntries = after.slice(0, after.length - before);

  const warnEntry = newEntries.find(
    (e) => (e.level === "warn" || e.level === "error") && e.area === "dean",
  );
  assert.ok(
    warnEntry,
    `expected an event-log warn/error entry with area='dean' after LLM outage — got none (RED: log.warn does not write to event log). new entries: ${JSON.stringify(newEntries)}`,
  );
});

test("G15: dean LLM HTTP-error → logEvent warn in event log", async () => {
  const realFetch = globalThis.fetch;
  const realKey = config.llm.anthropicKey;
  config.llm.anthropicKey = "test-key-set";
  globalThis.fetch = (async () =>
    new Response("Service Unavailable", {
      status: 503,
      headers: { "content-type": "text/plain" },
    })) as typeof fetch;

  const before = getEventLog().recent(100).length;
  try {
    await runDean(deanSubmission(), deanAuthorReport(), deanTokenReport());
  } finally {
    globalThis.fetch = realFetch;
    config.llm.anthropicKey = realKey;
  }

  const after = getEventLog().recent(100);
  const newEntries = after.slice(0, after.length - before);

  const warnEntry = newEntries.find(
    (e) => (e.level === "warn" || e.level === "error") && e.area === "dean",
  );
  assert.ok(
    warnEntry,
    `expected an event-log warn entry with area='dean' after LLM HTTP error — got none (RED: log.warn does not write to event log). new entries: ${JSON.stringify(newEntries)}`,
  );
});
