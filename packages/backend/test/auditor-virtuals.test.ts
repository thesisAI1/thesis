/**
 * The Auditor on a Virtuals Protocol (Base) token.
 *
 * A graduated Virtuals agent token is VIRTUAL-paired; the data adapter reports
 * its launchpad as "virtuals", which is trusted on Base. So the token must CLEAR
 * the launchpad gate (no "not launched via" flag) and carry launchpad "virtuals"
 * on the report — exactly as a Clanker/Bankr token does. Other gates (age, mcap,
 * concentration) still apply on their own merits.
 *
 * Deterministic: MockBaseData maps any address containing "virtuals" to the
 * "virtuals" launchpad (mirrors the Solana "pump"-suffix rule). RED until that
 * sentinel + the VIRTUAL-quoted detection land.
 */

import "./helpers/isolate-store.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Submission } from "@thesis/shared";
import { runAuditor } from "../src/agents/auditor.js";

function baseSubmission(address: string): Submission {
  return {
    postId: `p-${address.slice(0, 6)}`,
    authorXId: "1",
    authorHandle: "@base_caller",
    thesisText: "graduated Virtuals agent, VIRTUAL-paired pool, organic holders",
    contractAddress: address,
    chain: "base",
    postUrl: "https://x.com/base_caller/status/1",
    postedAt: new Date().toISOString(),
  };
}

test("Auditor: a virtuals token is reported as launchpad 'virtuals' and clears the launchpad gate", async () => {
  const report = await runAuditor(baseSubmission("0xVIRTUALSgraduatedAgentToken000000000000001"));
  assert.equal(report.chain, "base");
  assert.equal(report.launchpad, "virtuals", "a graduated Virtuals token's launchpad must be 'virtuals'");
  assert.ok(
    !report.flags.some((f) => /not launched via/i.test(f)),
    `virtuals must clear the launchpad gate; flags=${JSON.stringify(report.flags)}`,
  );
});

test("Auditor: a non-launchpad Base token is still rejected, naming virtuals among trusted", async () => {
  // The mock seeds some addresses to a non-trusted launchpad ("uniswap"). Probe
  // for one so the reject path is exercised deterministically.
  const { createBaseDataAdapter } = await import("../src/adapters/basedata/index.js");
  const data = createBaseDataAdapter("base");
  let rejectAddr = "";
  for (let i = 0; i < 80; i++) {
    const candidate = `0xPLAINnonLaunchpadToken${i.toString().padStart(4, "0")}00000000`;
    const t = await data.getToken(candidate);
    if (!["clanker", "bankr", "virtuals"].includes((t.launchpad ?? "").toLowerCase())) {
      rejectAddr = candidate;
      break;
    }
  }
  assert.ok(rejectAddr, "expected at least one non-trusted-launchpad mock token");
  const report = await runAuditor(baseSubmission(rejectAddr));
  assert.equal(report.score, 0, "a non-trusted-launchpad Base token must score 0");
  assert.ok(
    report.flags.some((f) => /not launched via/i.test(f) && /virtuals/i.test(f)),
    `reject flag must enumerate virtuals among trusted; flags=${JSON.stringify(report.flags)}`,
  );
});
