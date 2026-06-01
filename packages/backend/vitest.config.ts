import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The store contract spec spins up real FileStore + SQLite instances and
    // replays a migration per PrismaStore case; keep them serial so the shared
    // Prisma engine and temp-dir churn stay predictable.
    //
    // Scoped to *.vitest.ts: the rest of the backend suite runs under node:test
    // (root `npm test` globs test/*.test.ts), so these store-parity specs use a
    // distinct suffix to keep the two runners from colliding on the same files.
    include: ["test/**/*.vitest.ts"],
    fileParallelism: false,
  },
});
