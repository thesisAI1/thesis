-- CreateTable
CREATE TABLE "Event" (
    "id"      INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "at"      TEXT NOT NULL,
    "level"   TEXT NOT NULL,
    "area"    TEXT NOT NULL,
    "type"    TEXT NOT NULL,
    "msg"     TEXT NOT NULL,
    "opsType" TEXT
);

-- CreateIndex
CREATE INDEX "Event_at_idx" ON "Event"("at");

-- CreateIndex
CREATE INDEX "Event_opsType_at_idx" ON "Event"("opsType", "at");
