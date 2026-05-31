/**
 * Tier B fixture-replay test — KyberSwap pure-parser functions.
 *
 * Tests parseKyberRoute and parseKyberBuild against synthetic fixtures to pin
 * the `code === 0` success check, the `data.routeSummary` presence guard, and
 * the shape of the extracted fields (amountOut, routerAddress, calldata).
 *
 * These are pure functions — no network, no private key, no RealChain.
 *
 * TODO(tier-b): swap in a real captured payload (record a live KyberSwap API
 * call, save the raw JSON to test/fixtures/kyber-route.json and
 * test/fixtures/kyber-build.json, remove the __synthetic keys).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { parseKyberRoute, parseKyberBuild } from "../src/adapters/chain/kyber-parse.js";
import type { KyberApiResponse, KyberRouteData, KyberBuildData } from "../src/adapters/chain/kyber-parse.js";

const require = createRequire(import.meta.url);
const routeFixture = require("./fixtures/kyber-route.json") as KyberApiResponse<KyberRouteData>;
const buildFixture = require("./fixtures/kyber-build.json") as KyberApiResponse<KyberBuildData>;

// --- parseKyberRoute ---

test("parseKyberRoute: extracts routeSummary and routerAddress from a success response", () => {
  const result = parseKyberRoute(routeFixture);

  // PIN: routerAddress is present.
  assert.equal(
    result.routerAddress,
    "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
    "routerAddress must match fixture",
  );

  // PIN: amountOut is present on routeSummary.
  assert.equal(
    result.routeSummary.amountOut,
    "5000000000000000000",
    "routeSummary.amountOut must match fixture",
  );

  // PIN: routeSummary.route fills are accessible.
  assert.ok(
    Array.isArray(result.routeSummary.route),
    "routeSummary.route must be an array",
  );
});

test("parseKyberRoute: throws when code !== 0", () => {
  const bad: KyberApiResponse<KyberRouteData> = { code: 4008, message: "no liquidity" };
  assert.throws(
    () => parseKyberRoute(bad),
    /KyberSwap.*no liquidity/,
    "must throw a descriptive error on non-zero code",
  );
});

test("parseKyberRoute: throws when data.routeSummary is missing", () => {
  const bad: KyberApiResponse<KyberRouteData> = {
    code: 0,
    data: { routeSummary: undefined as unknown as KyberRouteData["routeSummary"], routerAddress: "" },
  };
  assert.throws(
    () => parseKyberRoute(bad),
    /KyberSwap/,
    "must throw when routeSummary is falsy",
  );
});

// --- parseKyberBuild ---

test("parseKyberBuild: extracts amountOut, routerAddress, and calldata from a success response", () => {
  const result = parseKyberBuild(buildFixture);

  // PIN: calldata field is present (the key shape risk — if renamed, this fails).
  assert.ok(result.data && result.data.length > 0, "data (calldata) must be present and non-empty");

  // PIN: routerAddress matches.
  assert.equal(
    result.routerAddress,
    "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
    "routerAddress must match fixture",
  );

  // PIN: amountOut is present.
  assert.equal(
    result.amountOut,
    "5000000000000000000",
    "amountOut must match fixture",
  );
});

test("parseKyberBuild: throws when code !== 0", () => {
  const bad: KyberApiResponse<KyberBuildData> = { code: 4001, message: "build failed" };
  assert.throws(
    () => parseKyberBuild(bad),
    /KyberSwap.*build failed/,
    "must throw a descriptive error on non-zero code",
  );
});

test("parseKyberBuild: throws when data.data (calldata) is missing", () => {
  const bad: KyberApiResponse<KyberBuildData> = {
    code: 0,
    data: {
      amountIn: "1",
      amountOut: "1",
      data: "",   // empty string is falsy
      routerAddress: "0xrouter",
    },
  };
  assert.throws(
    () => parseKyberBuild(bad),
    /KyberSwap/,
    "must throw when calldata is empty/missing",
  );
});
