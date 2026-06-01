/**
 * Integration test for scripts/migrate-json-to-sqlite.ts — the JSON→SQLite
 * one-shot. Pins the money-safety properties the migration must hold:
 *   - escrow keeps its `chain` (a Solana escrow stays SOL, never summed into base)
 *   - per-chain buy lanes (`buyLogByChain`) survive (rate-limit history intact)
 *   - the pending-buy WAL survives with its chain
 *   - a historical CLOSED position is stamped settled (never re-paid on resume)
 *   - it REFUSES to run onto a non-empty store (no double-append on re-run)
 *
 * Schema is applied per-test by replaying the committed init migration against a
 * temp SQLite file (same DDL as production), exactly like the store contract spec.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PrismaStore } from "../src/store/prismaStore.js";
import { migrate } from "../scripts/migrate-json-to-sqlite.js";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const MIGRATIONS_DIR = resolve(HERE, "..", "prisma", "migrations");

/** Apply EVERY committed migration (in lexical order) to a per-test SQLite
 *  file — the same DDL production gets via `prisma migrate deploy`. Replaying
 *  all migrations (not just the init) means new columns are picked up
 *  automatically instead of silently missing from the test schema. */
async function applySchema(dataDir: string): Promise<void> {
  const dbPath = resolve(dataDir, "thesis.db");
  const client = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
  const migrationDirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const dir of migrationDirs) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
    const statements = sql
      .split(";")
      .map((chunk) =>
        chunk
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter((stmt) => stmt.length > 0);
    for (const stmt of statements) await client.$executeRawUnsafe(stmt);
  }
  await client.$disconnect();
}

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "thesis-migrate-"));
}

/** A legacy JSON snapshot exercising every per-chain path + a historical close. */
function fixture(): unknown {
  return {
    positions: [
      {
        id: "pos-1",
        postId: "post-1",
        authorXId: "x1",
        authorHandle: "@a",
        order: { contractAddress: "0xCA", chain: "base", amountInEth: 0.05, takeProfits: [], stopLossX: 0.7 },
        status: "closed",
        entryPriceEth: 0.001,
        entryTxHash: "0xTX",
        remainingFraction: 0,
        tiersHit: 1,
        realisedPnlEth: 0.5,
        openedAt: "2026-01-01T00:00:00.000Z",
        closedAt: "2026-02-01T00:00:00.000Z",
        // NO settledAt — a historical close that MUST be stamped on migrate.
      },
    ],
    escrow: {
      x1: { xUserId: "x1", handle: "@a", amountEth: 0.5, chain: "base", updatedAt: "2026-01-01T00:00:00.000Z" },
      "x1:solana": { xUserId: "x1", handle: "@a", amountEth: 0.3, chain: "solana", updatedAt: "2026-01-01T00:00:00.000Z" },
    },
    buyLog: ["2026-01-01T10:00:00.000Z"],
    buyLogByChain: { solana: ["2026-01-01T12:00:00.000Z"] },
    pendingBuys: [
      { postId: "pp", contractAddress: "0xC", amountInEth: 0.05, at: "2026-01-01T00:00:00.000Z", chain: "solana" },
    ],
  };
}

async function seedAndMigrate(dir: string): Promise<void> {
  await applySchema(dir);
  const jsonPath = join(dir, "thesis-data.json");
  writeFileSync(jsonPath, JSON.stringify(fixture()));
  await migrate(jsonPath, dir);
}

test("migrate-json: preserves escrow chain, per-chain buys, pending buys; stamps historical closes settled", async () => {
  const dir = freshDir();
  await seedAndMigrate(dir);

  const store = new PrismaStore(dir);
  try {
    // escrow: base and solana preserved INDEPENDENTLY (the solana balance is not
    // collapsed into / summed with base).
    assert.equal((await store.getEscrow("x1", "base"))?.amountEth, 0.5);
    const sol = await store.getEscrow("x1", "solana");
    assert.equal(sol?.amountEth, 0.3);
    assert.equal(sol?.chain, "solana");

    // per-chain buy lanes preserved (rate-limit history intact)
    assert.equal(await store.countBuysSince("2026-01-01T00:00:00.000Z", "base"), 1);
    assert.equal(await store.countBuysSince("2026-01-01T00:00:00.000Z", "solana"), 1);

    // pending-buy WAL preserved with its chain
    const pending = await store.getPendingBuys();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.chain, "solana");

    // historical closed position stamped settled → the monitor won't re-pay it
    assert.deepEqual(await store.getUnsettledClosedPositions(), []);
  } finally {
    await store.disconnect();
  }
});

test("migrate-json: refuses to migrate onto a non-empty store (no double-append)", async () => {
  const dir = freshDir();
  await seedAndMigrate(dir); // first run populates the db

  const jsonPath = join(dir, "thesis-data.json");
  // A second run must throw rather than double the append-style collections.
  await assert.rejects(() => migrate(jsonPath, dir), /not empty|refusing/i);
});
