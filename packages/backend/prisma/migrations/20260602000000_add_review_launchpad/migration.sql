-- Add the launchpad source ("clanker" | "bankr" | "virtuals" | "pumpfun" | null)
-- to a Review so the dashboard can show a per-token source badge. Additive +
-- nullable: existing rows backfill to NULL, no data migration needed.
ALTER TABLE "Review" ADD COLUMN "launchpad" TEXT;
