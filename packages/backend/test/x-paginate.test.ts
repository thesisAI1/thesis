/**
 * Pure cursor pagination (adapters/x/paginate.ts).
 *
 * Pins the "drain every page" loop that fixes the old one-page mention fetch:
 * a poll that found >100 new mentions (a burst or restart backlog) silently
 * dropped everything past the first page. No HTTP — the page fetcher is a fake.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { drainPages, type Page } from "../src/adapters/x/paginate.js";

test("drainPages: follows next_token across pages, passing the prior token each time", async () => {
  const pages: Page<number>[] = [
    { items: [1, 2], nextToken: "t1" },
    { items: [3, 4], nextToken: "t2" },
    { items: [5] }, // last page — no nextToken
  ];
  const tokensSeen: Array<string | undefined> = [];
  let i = 0;
  const out = await drainPages(async (tok) => {
    tokensSeen.push(tok);
    return pages[i++];
  }, 10);

  assert.deepEqual(out, [1, 2, 3, 4, 5]);
  assert.deepEqual(tokensSeen, [undefined, "t1", "t2"]); // first page has no token
});

test("drainPages: stops at maxPages even when more pages remain (bounds API spend)", async () => {
  let calls = 0;
  const out = await drainPages(async () => {
    calls++;
    return { items: [calls], nextToken: "always-more" };
  }, 3);
  assert.equal(calls, 3);
  assert.deepEqual(out, [1, 2, 3]);
});

test("drainPages: a single page (no next_token) makes exactly one call", async () => {
  let calls = 0;
  const out = await drainPages(async () => {
    calls++;
    return { items: ["a"] };
  }, 5);
  assert.equal(calls, 1);
  assert.deepEqual(out, ["a"]);
});

test("drainPages: maxPages is floored to 1 (never zero calls)", async () => {
  let calls = 0;
  await drainPages(async () => {
    calls++;
    return { items: [], nextToken: "x" };
  }, 0);
  assert.equal(calls, 1);
});
