/**
 * Wave 5 — the Auditor on Solana.
 *
 * The Auditor must fetch from the submission's chain's data source and gate the
 * launchpad per chain: pump.fun is trusted on Solana (Clanker/Bankr are not).
 * A non-pump.fun Solana token scores 0, so the existing evaluateBuyGate vetoes
 * the buy on both chains — no new veto plumbing needed.
 *
 * Deterministic: MockSolanaData maps any "pump"-suffixed mint to pumpfun; we
 * probe it to find a stable non-pumpfun mint for the reject path.
 */

import "./helpers/isolate-store.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Submission } from "@thesis/shared";
import { runAuditor } from "../src/agents/auditor.js";
import { createBaseDataAdapter } from "../src/adapters/basedata/index.js";

function solSubmission(mint: string): Submission {
  return {
    postId: `p-${mint.slice(0, 6)}`,
    authorXId: "1",
    authorHandle: "@sol_caller",
    thesisText: "clean pump.fun launch, organic holders, real momentum building",
    contractAddress: mint,
    chain: "solana",
    postUrl: "https://x.com/sol_caller/status/1",
    postedAt: new Date().toISOString(),
  };
}

test("Auditor: a pump.fun mint is audited on solana and clears the launchpad gate", async () => {
  const report = await runAuditor(solSubmission("6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfpump"));
  assert.equal(report.chain, "solana", "authoritative chain must be solana");
  assert.equal(report.launchpad, "pumpfun");
  // It must NOT be rejected for the launchpad — pump.fun is trusted on Solana.
  assert.ok(
    !report.flags.some((f) => /not launched via/i.test(f)),
    `pump.fun must clear the launchpad gate; flags=${JSON.stringify(report.flags)}`,
  );
});

test("Auditor: a non-pump.fun Solana token scores 0 (launchpad reject)", async () => {
  // Find a stable non-pumpfun mint from the seeded mock (no 'pump' suffix).
  const data = createBaseDataAdapter("solana");
  let rejectMint = "";
  for (let i = 0; i < 50; i++) {
    const candidate = `RaydiumNativeMint${i}1111111111111111111111`;
    const t = await data.getToken(candidate);
    if (t.launchpad !== "pumpfun") {
      rejectMint = candidate;
      break;
    }
  }
  assert.ok(rejectMint, "expected at least one non-pumpfun mock mint");
  const report = await runAuditor(solSubmission(rejectMint));
  assert.equal(report.chain, "solana");
  assert.equal(report.score, 0, "non-pump.fun Solana token must score 0");
  assert.ok(
    report.flags.some((f) => /not launched via/i.test(f) && /pump\.fun/i.test(f)),
    `reject flag must name pump.fun; flags=${JSON.stringify(report.flags)}`,
  );
});

test("Auditor: Base path is unchanged — an EVM submission audits on base", async () => {
  const report = await runAuditor({
    ...solSubmission("0x36e807119529E44d6F36aD5CE24AeB87a4529ba3"),
    chain: "base",
  });
  assert.equal(report.chain, "base");
});
