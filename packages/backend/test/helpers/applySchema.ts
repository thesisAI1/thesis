/**
 * Shared schema helper — applies every committed migration (lexical order) to a
 * per-test SQLite file. Both prismaEventLog.vitest.ts and store.contract.vitest.ts
 * use this to get schema-isolated, production-DDL-identical test databases.
 *
 * Splitter strategy (robust): strip `--` comment lines from each chunk, then slice
 * from the first line that starts with a SQL keyword. This handles block comments
 * that contain semicolons (which corrupt a naive split).
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const MIGRATIONS_DIR = resolve(HERE, "..", "..", "prisma", "migrations");

const SQL_KEYWORD = /^(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|PRAGMA|BEGIN|COMMIT)/i;

export async function applySchema(dataDir: string): Promise<void> {
  const dbPath = resolve(dataDir, "thesis.db");
  const client = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
  });
  const migrationDirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const dir of migrationDirs) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
    const statements = sql
      .split(";")
      .map((chunk) => {
        // Strip comment lines, then find the first line starting with a SQL keyword.
        const lines = chunk.split("\n").filter((line) => !line.trim().startsWith("--"));
        const keywordIdx = lines.findIndex((line) => SQL_KEYWORD.test(line.trim()));
        if (keywordIdx === -1) return "";
        return lines.slice(keywordIdx).join("\n").trim();
      })
      .filter((stmt) => stmt.length > 0 && SQL_KEYWORD.test(stmt));
    for (const stmt of statements) {
      await client.$executeRawUnsafe(stmt);
    }
  }
  await client.$disconnect();
}
