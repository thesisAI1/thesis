/**
 * MERGE-SAFETY — the schema-v1 load migration must not re-pay historical trades.
 *
 * getUnsettledClosedPositions = `closed && !settledAt`. Every position written
 * before `settledAt` existed lacks it, so WITHOUT a migration the monitor's
 * resume pass would treat every historical closed trade as unsettled and re-run
 * settlement (re-paying author + team + buyback) on the first tick after prod
 * upgrades to this branch — a large double-spend on merge.
 *
 * The migration stamps pre-v1 closed positions terminally settled, exactly once
 * (gated on schemaVersion), without touching post-migration closed positions
 * that legitimately still need a settlement retry.
 *
 * Drives FileStore directly against hand-written legacy data files.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../src/store/fileStore.js";

/** Write a thesis-data.json with the given top-level shape to a fresh temp dir. */
function tempStoreFile(data: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "thesis-migrate-"));
  writeFileSync(join(dir, "thesis-data.json"), JSON.stringify(data));
  return dir;
}

/** A minimal closed-position record as the OLD code would have written it —
 *  no settledAt, no settlement. (Cast through unknown: the on-disk shape is
 *  intentionally pre-migration.) */
function legacyClosed(id: string): Record<string, unknown> {
  return {
    id,
    postId: `${id}-post`,
    authorXId: `${id}-author`,
    authorHandle: "@author",
    postUrl: `https://x.com/x/status/${id}`,
    order: {
      contractAddress: "0xabcabcabcabcabcabcabcabcabcabcabcabcabca",
      chain: "base",
      amountInEth: 0.1,
      takeProfits: [{ priceX: 2, sellFraction: 1 }],
      stopLossX: 0.7,
    },
    status: "closed",
    entryPriceEth: 1e-8,
    entryTxHash: "0xentry",
    remainingFraction: 0,
    tiersHit: 1,
    realisedPnlEth: 0.5, // profitable — the dangerous case (would re-pay)
    openedAt: "2024-01-01T00:00:00.000Z",
    closedAt: "2024-01-02T00:00:00.000Z",
  };
}

test("migration stamps a legacy closed position settled (so it is NOT re-settled/re-paid)", async () => {
  const dir = tempStoreFile({ positions: [legacyClosed("legacy-1")] }); // no schemaVersion
  const store = new FileStore(dir);

  const unsettled = await store.getUnsettledClosedPositions();
  assert.equal(
    unsettled.length,
    0,
    "a pre-existing closed trade must NOT be seen as unsettled — that would re-pay it on merge",
  );

  const p = (await store.getAllPositions()).find((x) => x.id === "legacy-1");
  assert.ok(p?.settledAt, "the legacy closed position is stamped settled by the migration");
  assert.equal(p?.settlement?.authorDone, true, "all legs marked done (no leg re-runs)");
  assert.equal(p?.settlement?.buybackDone, true);
});

test("migration runs ONCE: a post-migration closed-unsettled position still retries", async () => {
  // Already migrated (schemaVersion 1) with a closed position lacking settledAt:
  // this is a genuine post-upgrade settlement awaiting retry — must be left alone.
  const dir = tempStoreFile({
    schemaVersion: 1,
    positions: [legacyClosed("needs-retry-1")],
  });
  const store = new FileStore(dir);

  const unsettled = await store.getUnsettledClosedPositions();
  assert.equal(unsettled.length, 1, "a post-migration unsettled close must still be retried");
  assert.equal(unsettled[0]?.id, "needs-retry-1");
});

test("migration leaves a fresh/empty store at the current schema version", async () => {
  const dir = mkdtempSync(join(tmpdir(), "thesis-migrate-fresh-"));
  const store = new FileStore(dir); // no file → EMPTY → migrate
  assert.deepEqual(await store.getUnsettledClosedPositions(), []);
  // A subsequently-added closed-unsettled position must be retryable (proves the
  // migration didn't leave the store in a "migrate every load" state).
  await store.savePosition({
    ...(legacyClosed("fresh-close") as unknown as Parameters<typeof store.savePosition>[0]),
  });
  assert.equal((await store.getUnsettledClosedPositions()).length, 1);
});
