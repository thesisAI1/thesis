-- Add the measured-delivery token count to Position.
--
-- Nullable on purpose: positions opened before this column read back as NULL,
-- and the monitor falls back to the market-mid cost-basis estimate
-- (amountInEth / entryPriceEth) for tier sizing. New buys record the actual
-- on-chain delivery (RealChain.buy), so their tiers size off the real bag.
ALTER TABLE "Position" ADD COLUMN "entryTokens" REAL;
