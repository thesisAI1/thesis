-- Deprecate (do NOT drop) the retired `toTeamEth` holder-lottery quarter.
-- The split is now 25% author / 50% portfolio / 25% buyback, so new
-- distributions leave toTeamEth NULL. We KEEP the column — now nullable —
-- to preserve the historical lottery payouts in the live DB and leave the
-- door open to re-enabling the lottery later.
-- SQLite cannot change a column's nullability in place, so redefine the table
-- (the pattern Prisma emits), copying ALL columns INCLUDING toTeamEth. Existing
-- values are preserved; only the NOT NULL constraint is relaxed. Column order
-- matches the original init layout (toTeamEth after toPortfolioEth).
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Distribution" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "positionId" TEXT NOT NULL,
    "totalProfitEth" REAL NOT NULL,
    "toAuthorEth" REAL NOT NULL,
    "toPortfolioEth" REAL NOT NULL,
    "toTeamEth" REAL,
    "toBuybackEth" REAL NOT NULL,
    "authorWallet" TEXT
);
INSERT INTO "new_Distribution" ("id", "positionId", "totalProfitEth", "toAuthorEth", "toPortfolioEth", "toTeamEth", "toBuybackEth", "authorWallet")
SELECT "id", "positionId", "totalProfitEth", "toAuthorEth", "toPortfolioEth", "toTeamEth", "toBuybackEth", "authorWallet" FROM "Distribution";
DROP TABLE "Distribution";
ALTER TABLE "new_Distribution" RENAME TO "Distribution";
PRAGMA foreign_keys=ON;
