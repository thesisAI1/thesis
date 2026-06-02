/**
 * The dashboard launchpad-source resolver (domain/launchpad-view.ts).
 *
 * Surfaces a position's launchpad ("clanker"/"bankr"/"virtuals"/…) for the
 * dashboard source badge from the review log. Resolution: the review linked to
 * the position by id wins; else the same-contract review (a token's launchpad is
 * stable, so the address fallback covers positions whose review predates the
 * launchpad field or isn't id-linked); else null.
 *
 * Pure function — RED until launchpad-view.ts exists.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReviewRecord } from "@thesis/shared";
import { buildLaunchpadResolver } from "../src/domain/launchpad-view.js";

function review(over: Partial<ReviewRecord>): ReviewRecord {
  return {
    reviewedAt: "2026-01-01T00:00:00.000Z",
    postId: "p",
    postUrl: "u",
    authorXId: "1",
    authorHandle: "@a",
    contractAddress: "0xCA",
    chain: "base",
    authorScore: 80,
    tokenScore: 90,
    launchpad: null,
    grade: "A",
    decision: "BUY",
    confidence: 1,
    rationale: "r",
    ...over,
  };
}

test("resolves by positionId (the precise path)", () => {
  const r = buildLaunchpadResolver([
    review({ positionId: "pos-1", contractAddress: "0xAAA", launchpad: "virtuals" }),
  ]);
  assert.equal(r("pos-1", "0xAAA"), "virtuals");
});

test("falls back to same-contract review when the position isn't id-linked", () => {
  const r = buildLaunchpadResolver([
    review({ positionId: undefined, contractAddress: "0xBBB", launchpad: "clanker" }),
  ]);
  // a different positionId, but the contract matches → fallback hits
  assert.equal(r("pos-unknown", "0xBBB"), "clanker");
});

test("address match is case-insensitive", () => {
  const r = buildLaunchpadResolver([
    review({ positionId: undefined, contractAddress: "0xAbCdEf", launchpad: "bankr" }),
  ]);
  assert.equal(r("pos-x", "0xABCDEF"), "bankr");
});

test("positionId takes precedence over the address fallback", () => {
  const r = buildLaunchpadResolver([
    review({ postId: "p1", positionId: "pos-1", contractAddress: "0xCC", launchpad: "virtuals" }),
    // a stray same-address review with a different launchpad must NOT override the
    // position's own linked review
    review({ postId: "p2", positionId: undefined, contractAddress: "0xCC", launchpad: "clanker" }),
  ]);
  assert.equal(r("pos-1", "0xCC"), "virtuals");
});

test("reviews with a null launchpad are ignored (no badge)", () => {
  const r = buildLaunchpadResolver([
    review({ positionId: "pos-1", contractAddress: "0xDD", launchpad: null }),
  ]);
  assert.equal(r("pos-1", "0xDD"), null);
});

test("unknown position + unknown address → null", () => {
  const r = buildLaunchpadResolver([
    review({ positionId: "pos-1", contractAddress: "0xEE", launchpad: "clanker" }),
  ]);
  assert.equal(r("pos-other", "0xFF"), null);
});
