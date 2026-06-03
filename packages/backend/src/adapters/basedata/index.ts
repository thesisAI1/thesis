/**
 * Adapter: Base-chain token data — holders, liquidity, launchpad, rug checks.
 *
 *   - MockBaseData    (./mock.ts)    — fake snapshot, $0
 *   - RealBaseData    (./real.ts)    — DexScreener + GoPlus (free public APIs)
 *   - BirdeyeBaseData (./birdeye.ts) — paid Birdeye feed (fast prices, no 429s)
 *
 * Provider chosen by env: Birdeye is used ONLY when BASEDATA_PROVIDER=birdeye
 * (and a key is present); otherwise — including the default "dexscreener" — we
 * use the DexScreener-based RealBaseData. Same interface across the board so the
 * rest of the codebase doesn't know or care which feed runs.
 *
 * NOTE: Birdeye's Base price index lags badly for low-cap Clanker tokens (it
 * served prices up to ~30% stale vs live DexScreener during a frozen-MC
 * incident), and that same feed drives the TP/SL monitor — so gating it behind
 * an explicit opt-in keeps the accurate DexScreener prices as the default.
 */

import type { Chain, Holder } from "@thesis/shared";
import { config, useMock } from "../../config.js";
import { BirdeyeBaseData } from "./birdeye.js";
import { MockBaseData } from "./mock.js";
import { RealBaseData } from "./real.js";
import { MockSolanaData } from "./solana.mock.js";
import { RealSolanaData } from "./solana.real.js";

/** A live snapshot of a token from one provider round: price (ETH), live
 *  market cap (USD), ticker, and logo. Symbol + logo ride along for free
 *  because the same provider response that carries price already includes
 *  them — so display surfaces don't need a separate per-token call each. */
export interface PriceSnapshotEth {
  priceEth: number;
  marketCapUsd: number;
  /** Token ticker from the priced pool's baseToken; "" when unknown. */
  symbol: string;
  /** DexScreener token logo (info.imageUrl) when present, else null. null is a
   *  RESOLVED "no logo" answer (the response was scanned), not "unknown". */
  logoUrl: string | null;
}

/** On-chain snapshot of a token. */
export interface TokenOnChain {
  contractAddress: string;
  chain: Chain;
  priceEth: number;
  liquidityUsd: number;
  marketCapUsd: number;
  /** ISO timestamp the token launched (its trading pair was created). */
  launchedAt: string;
  launchpad: string | null;
  isHoneypot: boolean;
  topHolders: Holder[];
}

export interface BaseDataAdapter {
  /** Full on-chain snapshot of a token. */
  getToken(address: string): Promise<TokenOnChain>;
  /** Current price in ETH — used by the TP/SL monitor. */
  getPriceEth(address: string): Promise<number>;
  /**
   * Batch price lookup — returns a map keyed by lowercased address. Providers
   * that natively support multi-price (Birdeye, DexScreener) do it in ONE
   * call; this is what keeps the monitor under the API rate limit when many
   * positions are open at once. Tokens with no price are simply absent from
   * the map (caller treats as "skip this tick").
   */
  getPricesEth(addresses: string[]): Promise<Map<string, number>>;
  /**
   * Batch live snapshot — price in ETH AND live market cap in USD — keyed by
   * lowercased address, from the SAME provider round as getPricesEth. Display
   * surfaces (dashboard, profit card) read the live MC directly instead of
   * estimating it as entryMC × (livePrice / entryFillPrice): the entry fill is
   * slippage-inflated vs the mid-price entryMC was quoted at, so that ratio
   * systematically understates a thin token's live MC (a real 160k showed as
   * ~130k). Optional — callers fall back to getPricesEth + the ratio estimate
   * when an adapter omits it or a token is absent from the map.
   */
  getSnapshotsEth?(addresses: string[]): Promise<Map<string, PriceSnapshotEth>>;
  /** Token ticker (e.g. "DEGEN"). Returns empty string when unknown. */
  getTokenSymbol(address: string): Promise<string>;
}

let _adapterLogged = false;
let _testOverride: BaseDataAdapter | null = null;

/** TEST ONLY — force a specific base-data adapter (e.g. one that simulates
 *  DexScreener returning no prices) so price-fallback behaviour can be
 *  exercised deterministically. Throws in production. Pass null to clear. */
export function __setBaseDataForTest(adapter: BaseDataAdapter | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("__setBaseDataForTest is not available in production");
  }
  _testOverride = adapter;
}

/**
 * Token-data adapter for `chain`. Defaults to "base" so every arg-less caller
 * is unchanged. Solana routes to the Solana data path (DexScreener Solana pairs
 * + GoPlus Solana + pump.fun detection); everything else uses the Base path
 * (Mock / Birdeye / DexScreener) exactly as before.
 */
export function createBaseDataAdapter(chain: Chain = "base"): BaseDataAdapter {
  if (_testOverride) return _testOverride;
  if (chain === "solana") {
    return useMock() ? new MockSolanaData() : new RealSolanaData();
  }
  if (useMock()) {
    if (!_adapterLogged) {
      console.log("[basedata] using MockBaseData");
      _adapterLogged = true;
    }
    return new MockBaseData();
  }
  const wantsBirdeye = config.baseData.provider.toLowerCase() === "birdeye";
  if (wantsBirdeye && config.baseData.birdeyeKey) {
    if (!_adapterLogged) {
      console.log(
        `[basedata] using BirdeyeBaseData (key len=${config.baseData.birdeyeKey.length})`,
      );
      _adapterLogged = true;
    }
    return new BirdeyeBaseData();
  }
  if (!_adapterLogged) {
    if (wantsBirdeye) {
      // Explicit birdeye request we can't honour (no key). Warn loudly rather
      // than silently dropping to DexScreener — a quiet fallback looks like a
      // config that "worked" and hides the missing key.
      console.warn(
        "[basedata] BASEDATA_PROVIDER=birdeye but BIRDEYE_API_KEY is unset — falling back to RealBaseData (DexScreener)",
      );
    } else {
      console.log(
        `[basedata] using RealBaseData (DexScreener — BASEDATA_PROVIDER='${config.baseData.provider}')`,
      );
    }
    _adapterLogged = true;
  }
  return new RealBaseData();
}
