/**
 * Birdeye provider — Virtuals detection + launchpad layering.
 *
 * Birdeye is the PRODUCTION data path (used when BIRDEYE_API_KEY is set). Its
 * launchpad detection layers explicit Bankr/Clanker proof OVER the VIRTUAL-paired
 * signal it reads off the same DexScreener call it makes for the launch date:
 *   launchpad = classifyLaunchpad(bankr/clanker) ?? virtualsFromPairs
 *
 * These tests stub global fetch per-endpoint to assert:
 *   1. a VIRTUAL-quoted token with no bankr/clanker proof → "virtuals"
 *   2. a Clanker-verified token that is ALSO VIRTUAL-quoted → "clanker" (layering)
 *   3. a plain WETH-quoted token with no proof → null (vetoed by the Auditor)
 */

import "./helpers/isolate-store.js";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { BirdeyeBaseData } from "../src/adapters/basedata/birdeye.js";

const VIRTUAL = config.chain.virtualToken; // mainnet default 0x0b3e…
const WETH = config.chain.weth;

const realFetch = globalThis.fetch;
const realKey = config.baseData.birdeyeKey;
const realScan = config.auditor.basescanApiKey;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Stub fetch per-endpoint. `opts` controls the two signals under test:
 *  the DexScreener pool's quote token, and the Blockscout contract name. */
function stubFetch(opts: { quote: string; blockscoutName: string | null }): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/defi/token_overview")) {
      return json({ data: { symbol: "AGENT", price: 1, liquidity: 200_000, marketCap: 1_500_000 } });
    }
    if (url.includes("api.bankr.bot")) return json({ error: "not found" }, 404); // not a Bankr launch
    if (url.includes("base.blockscout.com")) return json({ name: opts.blockscoutName });
    if (url.includes("dexscreener.com/latest/dex/tokens")) {
      return json({
        pairs: [
          { chainId: "base", pairCreatedAt: 1_700_000_000_000, quoteToken: { address: opts.quote } },
        ],
      });
    }
    // etherscan getcontractcreation is skipped (no basescan key) — fail loud if hit
    return json({}, 500);
  }) as typeof fetch;
}

beforeEach(() => {
  config.baseData.birdeyeKey = "test-key"; // let the adapter construct
  config.auditor.basescanApiKey = ""; // skip the Etherscan creation call (deployer=null)
});
afterEach(() => {
  globalThis.fetch = realFetch;
  config.baseData.birdeyeKey = realKey;
  config.auditor.basescanApiKey = realScan;
});

test("Birdeye: a VIRTUAL-quoted token with no bankr/clanker proof → 'virtuals'", async () => {
  stubFetch({ quote: VIRTUAL, blockscoutName: "AgentToken" });
  const t = await new BirdeyeBaseData().getToken("0xAgentVirtualsToken00000000000000000000a1");
  assert.equal(t.launchpad, "virtuals");
});

test("Birdeye: Clanker proof WINS over a VIRTUAL pairing (layering: detected ?? fromPairs)", async () => {
  // Verified Clanker contract name AND a VIRTUAL-quoted pool — clanker must win.
  stubFetch({ quote: VIRTUAL, blockscoutName: "ClankerToken" });
  const t = await new BirdeyeBaseData().getToken("0xClankerThatAlsoPairsVirtual0000000000b2");
  assert.equal(t.launchpad, "clanker");
});

test("Birdeye: a plain WETH-quoted token with no proof → null (Auditor will veto)", async () => {
  stubFetch({ quote: WETH, blockscoutName: "SomeRandomToken" });
  const t = await new BirdeyeBaseData().getToken("0xPlainWethToken000000000000000000000000c3");
  assert.equal(t.launchpad, null);
});
