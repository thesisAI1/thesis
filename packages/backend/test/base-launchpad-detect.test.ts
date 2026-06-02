/**
 * Virtuals Protocol detection on Base (adapters/basedata/base-launchpad.ts).
 *
 * A GRADUATED Virtuals agent token's locked LP is paired against $VIRTUAL on
 * Uniswap V2 — so any DexScreener pool whose QUOTE token is VIRTUAL identifies
 * the token as a Virtuals launch. Clanker/Bankr pools are WETH-quoted, so they
 * return null here (their detection stays the Bankr-API / Clanker-deployer path).
 * Pre-graduation tokens have no DEX pool at all and never reach this function.
 *
 * Pure function — RED until base-launchpad.ts exists.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectVirtualsLaunchpad } from "../src/adapters/basedata/base-launchpad.js";

const VIRTUAL = "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b";
const WETH = "0x4200000000000000000000000000000000000006";

test("a VIRTUAL-quoted pool is detected as virtuals", () => {
  assert.equal(
    detectVirtualsLaunchpad([{ quoteToken: { address: VIRTUAL } }], VIRTUAL),
    "virtuals",
  );
});

test("address match is case-insensitive (EVM addresses are checksum-cased)", () => {
  assert.equal(
    detectVirtualsLaunchpad([{ quoteToken: { address: VIRTUAL.toLowerCase() } }], VIRTUAL),
    "virtuals",
  );
});

test("a WETH-quoted pool (Clanker/Bankr) is NOT virtuals", () => {
  assert.equal(detectVirtualsLaunchpad([{ quoteToken: { address: WETH } }], VIRTUAL), null);
});

test("at least one VIRTUAL-quoted pool among several wins", () => {
  assert.equal(
    detectVirtualsLaunchpad(
      [{ quoteToken: { address: WETH } }, { quoteToken: { address: VIRTUAL } }],
      VIRTUAL,
    ),
    "virtuals",
  );
});

test("no pools / missing quoteToken → null (never throws)", () => {
  assert.equal(detectVirtualsLaunchpad([], VIRTUAL), null);
  assert.equal(detectVirtualsLaunchpad([{}], VIRTUAL), null);
  assert.equal(detectVirtualsLaunchpad([{ quoteToken: null }], VIRTUAL), null);
  assert.equal(detectVirtualsLaunchpad([{ quoteToken: { address: null } }], VIRTUAL), null);
});

test("unset VIRTUAL address (config blank) → null, never false-positives", () => {
  assert.equal(detectVirtualsLaunchpad([{ quoteToken: { address: VIRTUAL } }], ""), null);
  assert.equal(detectVirtualsLaunchpad([{ quoteToken: { address: VIRTUAL } }], undefined), null);
});
