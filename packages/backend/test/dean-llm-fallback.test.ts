/**
 * F6 — LLM-failure observability: when ANTHROPIC_API_KEY is set but the LLM
 * call fails (fetch throws or HTTP error), the Dean must:
 *   1. Still produce a valid verdict via rule-based fallback (safe default).
 *   2. Surface the failure via log.warn (OUTAGE), distinct from the "no key
 *      set → rules" path which stays quiet.
 *
 * Characterisation-level: we verify observable behaviour (verdict returned,
 * warn captured) rather than pinning exact log format.
 */

import "./helpers/isolate-store.js"; // MUST be first — temp DATA_DIR + mock mode
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AuthorReport, Submission, TokenReport } from "@thesis/shared";
import { config } from "../src/config.js";
import { runDean } from "../src/agents/dean.js";
import { log } from "../src/util/log.js";

// --- fixtures ---------------------------------------------------------------

function aSubmission(): Submission {
  return {
    postId: "post-f6",
    authorXId: "222",
    authorHandle: "@testuser",
    thesisText: "Solid project with good fundamentals and strong community backing.",
    contractAddress: "0x1234567890123456789012345678901234560001",
    chain: "base",
    postUrl: "https://x.com/testuser/status/1",
    postedAt: new Date().toISOString(),
  };
}

function anAuthorReport(): AuthorReport {
  return {
    authorXId: "222",
    score: 75,
    isLikelyBot: false,
    accountAgeDays: 300,
    smartFollowerCount: 40,
    pastContracts: [],
    pastHitRate: 0.25,
    flags: [],
    reasoning: [],
  };
}

function aHealthyToken(): TokenReport {
  return {
    contractAddress: "0x1234567890123456789012345678901234560001",
    chain: "base",
    score: 80,
    launchpad: "clanker",
    liquidityUsd: 40000,
    marketCapUsd: 400000,
    launchedAt: new Date(Date.now() - 4 * 3600_000).toISOString(),
    top10Concentration: 0.2,
    topHolders: [],
    isHoneypot: false,
    flags: [],
    reasoning: [],
  };
}

// --- helper: run fn with a stubbed fetch that throws -------------------------

async function withFetchThrowing(fn: () => Promise<void>): Promise<void> {
  const realFetch = globalThis.fetch;
  const realKey = config.llm.anthropicKey;
  config.llm.anthropicKey = "test-key-set"; // key IS set — this is the outage path
  globalThis.fetch = (async () => {
    throw new Error("simulated network timeout");
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = realFetch;
    config.llm.anthropicKey = realKey;
  }
}

// --- helper: run fn with a stubbed fetch that returns a non-ok status --------

async function withFetchHttpError(fn: () => Promise<void>): Promise<void> {
  const realFetch = globalThis.fetch;
  const realKey = config.llm.anthropicKey;
  config.llm.anthropicKey = "test-key-set";
  globalThis.fetch = (async () =>
    new Response("Service Unavailable", {
      status: 503,
      headers: { "content-type": "text/plain" },
    })) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = realFetch;
    config.llm.anthropicKey = realKey;
  }
}

// --- tests ------------------------------------------------------------------

test("dean: LLM fetch-throw → fallback verdict still returned", async () => {
  await withFetchThrowing(async () => {
    const verdict = await runDean(aSubmission(), anAuthorReport(), aHealthyToken());
    assert.ok(verdict, "verdict must be returned even when LLM throws");
    assert.ok(
      verdict.decision === "BUY" || verdict.decision === "SKIP",
      "decision must be a valid value",
    );
    assert.ok(verdict.grade, "grade must be set");
  });
});

test("dean: LLM HTTP-error → fallback verdict still returned", async () => {
  await withFetchHttpError(async () => {
    const verdict = await runDean(aSubmission(), anAuthorReport(), aHealthyToken());
    assert.ok(verdict, "verdict must be returned even when LLM returns 503");
    assert.ok(verdict.decision === "BUY" || verdict.decision === "SKIP");
  });
});

test("dean: LLM fetch-throw → warn surfaced (OUTAGE, not silent)", async () => {
  const warnings: string[] = [];
  const realWarn = log.warn;
  log.warn = (msg: string) => {
    warnings.push(msg);
    realWarn(msg);
  };
  try {
    await withFetchThrowing(async () => {
      await runDean(aSubmission(), anAuthorReport(), aHealthyToken());
    });
  } finally {
    log.warn = realWarn;
  }
  const outageWarn = warnings.find(
    (w) => w.toLowerCase().includes("outage") || w.toLowerCase().includes("failed"),
  );
  assert.ok(
    outageWarn,
    `expected a warn containing "OUTAGE" or "failed" but got: [${warnings.join(", ")}]`,
  );
});

test("dean: LLM HTTP-error → warn surfaced (OUTAGE, not silent)", async () => {
  const warnings: string[] = [];
  const realWarn = log.warn;
  log.warn = (msg: string) => {
    warnings.push(msg);
    realWarn(msg);
  };
  try {
    await withFetchHttpError(async () => {
      await runDean(aSubmission(), anAuthorReport(), aHealthyToken());
    });
  } finally {
    log.warn = realWarn;
  }
  const outageWarn = warnings.find(
    (w) => w.toLowerCase().includes("outage") || w.toLowerCase().includes("failed"),
  );
  assert.ok(
    outageWarn,
    `expected a warn containing "OUTAGE" or "failed" but got: [${warnings.join(", ")}]`,
  );
});

test("dean: no-key path (no API key) → no warn emitted (stays quiet)", async () => {
  const warnings: string[] = [];
  const realWarn = log.warn;
  log.warn = (msg: string) => {
    warnings.push(msg);
    realWarn(msg);
  };
  const realKey = config.llm.anthropicKey;
  config.llm.anthropicKey = ""; // deliberate no-key → rules path (not outage)
  try {
    await runDean(aSubmission(), anAuthorReport(), aHealthyToken());
    const llmWarn = warnings.find((w) => w.includes("dean:"));
    assert.equal(
      llmWarn,
      undefined,
      `no-key path must stay quiet; got warn: ${llmWarn}`,
    );
  } finally {
    log.warn = realWarn;
    config.llm.anthropicKey = realKey;
  }
});
