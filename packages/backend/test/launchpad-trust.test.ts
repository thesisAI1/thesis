/**
 * Wave 1 — per-chain trusted launchpads (util/launchpad.ts).
 *
 * The Auditor's hard gate trusts only launchpads that deploy a standard,
 * audited token + LP. On Base that's Clanker/Bankr; on Solana it's pump.fun
 * ONLY (user decision). Today the trust list is a Base-only module const in the
 * Auditor; this extracts it to a chain-keyed helper so the same gate works on
 * both chains and Base behavior is preserved exactly.
 *
 * RED until util/launchpad.ts exists (import fails); GREEN once it lands.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { trustedLaunchpads, isLaunchpadTrusted } from "../src/util/launchpad.js";

test("base trusts clanker and bankr (unchanged)", () => {
  assert.equal(isLaunchpadTrusted("base", "clanker"), true);
  assert.equal(isLaunchpadTrusted("base", "bankr"), true);
});

test("base does NOT trust pumpfun", () => {
  assert.equal(isLaunchpadTrusted("base", "pumpfun"), false);
});

test("solana trusts pumpfun ONLY", () => {
  assert.equal(isLaunchpadTrusted("solana", "pumpfun"), true);
  assert.equal(isLaunchpadTrusted("solana", "clanker"), false);
  assert.equal(isLaunchpadTrusted("solana", "bankr"), false);
});

test("trustedLaunchpads(solana) is exactly [pumpfun]", () => {
  assert.deepEqual(trustedLaunchpads("solana"), ["pumpfun"]);
});

test("matching is case-insensitive", () => {
  assert.equal(isLaunchpadTrusted("base", "Clanker"), true);
  assert.equal(isLaunchpadTrusted("solana", "PumpFun"), true);
});

test("null/empty/unknown launchpad is never trusted", () => {
  assert.equal(isLaunchpadTrusted("base", null), false);
  assert.equal(isLaunchpadTrusted("base", ""), false);
  assert.equal(isLaunchpadTrusted("solana", undefined), false);
  assert.equal(isLaunchpadTrusted("solana", "raydium"), false);
});
