-- Drop the retired `toTeamEth` column from Distribution.
-- The holder-lottery / team quarter was removed; the split is now
-- 25% author / 50% portfolio / 25% buyback, so the team slice no longer exists.
-- SQLite cannot DROP COLUMN portably here, so redefine the table (the same
-- pattern Prisma emits): create the new shape, copy the surviving columns,
-- swap. Historical toTeamEth values are intentionally not preserved.
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Distribution" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "positionId" TEXT NOT NULL,
    "totalProfitEth" REAL NOT NULL,
    "toAuthorEth" REAL NOT NULL,
    "toPortfolioEth" REAL NOT NULL,
    "toBuybackEth" REAL NOT NULL,
    "authorWallet" TEXT
);
INSERT INTO "new_Distribution" ("id", "positionId", "totalProfitEth", "toAuthorEth", "toPortfolioEth", "toBuybackEth", "authorWallet")
SELECT "id", "positionId", "totalProfitEth", "toAuthorEth", "toPortfolioEth", "toBuybackEth", "authorWallet" FROM "Distribution";
DROP TABLE "Distribution";
ALTER TABLE "new_Distribution" RENAME TO "Distribution";
PRAGMA foreign_keys=ON;
