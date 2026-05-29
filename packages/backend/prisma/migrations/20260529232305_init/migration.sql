-- CreateTable
CREATE TABLE "RegistryEntry" (
    "xUserId" TEXT NOT NULL PRIMARY KEY,
    "handle" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "linkedAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "authorXId" TEXT NOT NULL,
    "authorHandle" TEXT NOT NULL,
    "authorAvatarUrl" TEXT,
    "postUrl" TEXT,
    "order" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "entryPriceEth" REAL NOT NULL,
    "marketCapAtEntryUsd" REAL,
    "entryTxHash" TEXT NOT NULL,
    "remainingFraction" REAL NOT NULL,
    "tiersHit" INTEGER NOT NULL,
    "realisedPnlEth" REAL NOT NULL,
    "lastExitPriceEth" REAL,
    "lastExitTxHash" TEXT,
    "openedAt" TEXT NOT NULL,
    "closedAt" TEXT
);

-- CreateTable
CREATE TABLE "BuyLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "isoAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Escrow" (
    "xUserId" TEXT NOT NULL PRIMARY KEY,
    "handle" TEXT NOT NULL,
    "amountEth" REAL NOT NULL,
    "updatedAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "PayoutRequest" (
    "requestTweetId" TEXT NOT NULL PRIMARY KEY,
    "xUserId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "threadPostId" TEXT NOT NULL,
    "requestedAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ProcessedPost" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "postId" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Review" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reviewedAt" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "postUrl" TEXT NOT NULL,
    "authorXId" TEXT NOT NULL,
    "authorHandle" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "authorScore" REAL NOT NULL,
    "tokenScore" REAL NOT NULL,
    "grade" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "rationale" TEXT NOT NULL,
    "positionId" TEXT,
    "skippedReason" TEXT
);

-- CreateTable
CREATE TABLE "Distribution" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "positionId" TEXT NOT NULL,
    "totalProfitEth" REAL NOT NULL,
    "toAuthorEth" REAL NOT NULL,
    "toPortfolioEth" REAL NOT NULL,
    "toTeamEth" REAL NOT NULL,
    "toBuybackEth" REAL NOT NULL,
    "authorWallet" TEXT
);

-- CreateTable
CREATE TABLE "QueueItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "submission" JSONB NOT NULL,
    "priority" REAL NOT NULL,
    "enqueuedAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Funnel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "seen" INTEGER NOT NULL DEFAULT 0,
    "passed" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE INDEX "Position_status_idx" ON "Position"("status");

-- CreateIndex
CREATE INDEX "BuyLog_isoAt_idx" ON "BuyLog"("isoAt");

-- CreateIndex
CREATE INDEX "PayoutRequest_xUserId_idx" ON "PayoutRequest"("xUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedPost_postId_key" ON "ProcessedPost"("postId");
