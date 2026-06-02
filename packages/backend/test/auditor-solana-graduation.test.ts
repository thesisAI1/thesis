/**
 * The Auditor on a Solana pump.fun token — graduated-only trust.
 *
 * In mock mode MockSolanaData stands a "pump"-suffixed mint in for a GENUINELY
 * graduated pump.fun token: launchpad "pumpfun" (trusted on Solana), so it must
 * CLEAR the launchpad gate. A non-"pump" mint is untrusted (launchpad null) and
 * must score 0 — the buy is vetoed. And because graduation subsumes honeypot
 * risk, the report's isHoneypot is always false on Solana.
 *
 * Mirrors auditor-virtuals (the Base analogue): assert the launchpad-gate
 * outcome in isolation, not a seed-dependent overall score.
 */

import "./helpers/isolate-store.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Submission } from "@thesis/shared";
import { runAuditor } from "../src/agents/auditor.js";

const GRADUATED_MINT = "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfpump";
const NON_GRADUATED_MINT = "RaydiumNativeMint1111111111111111111111111";

function solSubmission(address: string): Submission {
  return {
    postId: `p-${address.slice(0, 6)}`,
    authorXId: "1",
    authorHandle: "@sol_caller",
    thesisText: "graduated pump.fun token, LP migrated and locked, organic holders",
    contractAddress: address,
    chain: "solana",
    postUrl: "https://x.com/sol_caller/status/1",
    postedAt: new Date().toISOString(),
  };
}

test("Auditor: a graduated pump.fun mint is launchpad 'pumpfun' and clears the launchpad gate", async () => {
  const report = await runAuditor(solSubmission(GRADUATED_MINT));
  assert.equal(report.chain, "solana");
  assert.equal(report.launchpad, "pumpfun", "a graduated pump.fun token's launchpad must be 'pumpfun'");
  assert.ok(
    !report.flags.some((f) => /not launched via/i.test(f)),
    `graduated pump.fun must clear the launchpad gate; flags=${JSON.stringify(report.flags)}`,
  );
  assert.equal(report.isHoneypot, false, "honeypot factor is removed for Solana — always false");
});

test("Auditor: a non-graduated Solana mint scores 0 (launchpad gate vetoes the buy)", async () => {
  const report = await runAuditor(solSubmission(NON_GRADUATED_MINT));
  assert.equal(report.chain, "solana");
  assert.equal(report.launchpad, null, "a non-graduated mint must carry no trusted launchpad");
  assert.equal(report.score, 0, "a non-graduated Solana token must score 0");
  assert.ok(
    report.flags.some((f) => /not launched via/i.test(f) && /pump\.fun/i.test(f)),
    `reject flag must name pump.fun as the trusted launchpad; flags=${JSON.stringify(report.flags)}`,
  );
  assert.equal(report.isHoneypot, false, "honeypot factor is removed for Solana — always false");
});
