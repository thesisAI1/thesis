/**
 * Sanity test — proves the test harness itself runs.
 *
 * Run the whole suite with:  npm test
 * (Uses Node's built-in test runner via the tsx loader — zero extra deps.)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

test("test harness runs", () => {
  assert.equal(1 + 1, 2);
});
