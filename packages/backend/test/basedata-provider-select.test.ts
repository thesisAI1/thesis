/**
 * Regression guard — the Base data-adapter selection must honour
 * BASEDATA_PROVIDER, not merely the presence of a Birdeye key.
 *
 * Frozen-market-cap incident: setting BIRDEYE_API_KEY on prod silently flipped
 * the Base price source to Birdeye (whose Base index lagged ~30% behind live
 * DexScreener for active Clanker tokens), even though BASEDATA_PROVIDER still
 * said "dexscreener". That stale feed also drives the TP/SL monitor. The factory
 * must use DexScreener (RealBaseData) unless the provider is explicitly "birdeye".
 *
 * RED→GREEN: before the fix, the first assertion failed (a key-present prod
 * returned BirdeyeBaseData regardless of provider).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { createBaseDataAdapter } from "../src/adapters/basedata/index.js";
import { RealBaseData } from "../src/adapters/basedata/real.js";
import { BirdeyeBaseData } from "../src/adapters/basedata/birdeye.js";

test("createBaseDataAdapter: Base price source honours BASEDATA_PROVIDER, not key presence", () => {
  const orig = {
    mode: config.mode,
    provider: config.baseData.provider,
    key: config.baseData.birdeyeKey,
  };
  try {
    config.mode = "live"; // leave mock mode so the real/birdeye branch is reachable
    config.baseData.birdeyeKey = "test-birdeye-key"; // a key IS present (prod's state)

    // Default provider → DexScreener, EVEN with a key set (this is the regression).
    config.baseData.provider = "dexscreener";
    assert.ok(
      createBaseDataAdapter("base") instanceof RealBaseData,
      "provider=dexscreener must use RealBaseData even when a Birdeye key is present",
    );

    // Explicit opt-in + key → Birdeye.
    config.baseData.provider = "birdeye";
    assert.ok(
      createBaseDataAdapter("base") instanceof BirdeyeBaseData,
      "provider=birdeye with a key must use BirdeyeBaseData",
    );

    // Provider is matched case-insensitively ("Birdeye"/"BIRDEYE" still opt in).
    config.baseData.provider = "BIRDEYE";
    assert.ok(
      createBaseDataAdapter("base") instanceof BirdeyeBaseData,
      "BASEDATA_PROVIDER must be matched case-insensitively",
    );

    // Birdeye requested but no key → safe DexScreener fallback (never throws).
    config.baseData.provider = "birdeye";
    config.baseData.birdeyeKey = "";
    assert.ok(
      createBaseDataAdapter("base") instanceof RealBaseData,
      "provider=birdeye without a key must fall back to RealBaseData",
    );
  } finally {
    config.mode = orig.mode;
    config.baseData.provider = orig.provider;
    config.baseData.birdeyeKey = orig.key;
  }
});
