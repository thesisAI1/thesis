/**
 * RED-first test for FileStore instance isolation.
 *
 * FileStore seeds an empty store via `{ ...EMPTY }` — a SHALLOW spread of a
 * module-level constant. Before the fix, a push() on any nested array (positions,
 * buyLog, etc.) mutates the shared EMPTY reference, so EVERY later FileStore
 * instance in the same process starts with that data instead of clean state.
 *
 * This test pins the isolation invariant: two FileStore instances over SEPARATE
 * temp dirs MUST NOT share state. It must FAIL (RED) on the unpatched FileStore
 * and PASS (GREEN) after the structuredClone fix.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileStore } from "../src/store/fileStore.js";

function freshDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `thesis-isolation-${label}-`));
}

describe("FileStore instance isolation", () => {
  it("savePosition on store A does not appear in a fresh store B over a different dir", async () => {
    const dirA = freshDir("A");
    const dirB = freshDir("B");

    const storeA = new FileStore(dirA);
    await storeA.savePosition({
      id: "p-from-A",
      postId: "po1",
      authorXId: "x-1",
      authorHandle: "@a",
      order: {
        contractAddress: "0xCA",
        chain: "base",
        amountInEth: 0.05,
        takeProfits: [],
        stopLossX: 0.7,
      },
      status: "open",
      entryPriceEth: 0.001,
      entryTxHash: "0xTX",
      remainingFraction: 1,
      tiersHit: 0,
      realisedPnlEth: 0,
      openedAt: "2026-01-01T00:00:00.000Z",
    });

    // B is constructed AFTER A has mutated the module-level EMPTY.
    const storeB = new FileStore(dirB);
    const positionsInB = await storeB.getAllPositions();

    // B is a fresh dir — it must start empty, never seeing A's data.
    expect(positionsInB).toEqual([]);
  });

  it("buyLog on store A does not appear in a fresh store B", async () => {
    const dirA = freshDir("buyA");
    const dirB = freshDir("buyB");

    const storeA = new FileStore(dirA);
    await storeA.recordBuy("2026-01-01T00:00:00.000Z");

    const storeB = new FileStore(dirB);
    expect(await storeB.lastBuyAt()).toBeNull();
    expect(await storeB.countBuysSince("2000-01-01T00:00:00.000Z")).toBe(0);
  });
});
