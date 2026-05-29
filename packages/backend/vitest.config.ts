import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The store contract spec spins up real FileStore + SQLite instances and
    // replays a migration per PrismaStore case; keep them serial so the shared
    // Prisma engine and temp-dir churn stay predictable.
    include: ["test/**/*.test.ts"],
    fileParallelism: false,
  },
});
