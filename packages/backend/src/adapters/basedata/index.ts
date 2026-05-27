/**
 * Adapter: Base-chain token data — holders, liquidity, launchpad, rug checks.
 *
 *   - MockBaseData    (./mock.ts)    — fake snapshot, $0
 *   - RealBaseData    (./real.ts)    — DexScreener + GoPlus (free public APIs)
 *   - BirdeyeBaseData (./birdeye.ts) — paid Birdeye feed (fast prices, no 429s)
 *
 * Provider chosen by env: if BIRDEYE_API_KEY is set we use Birdeye, otherwise
 * we fall back to the DexScreener-based RealBaseData. Same interface across
 * the board so the rest of the codebase doesn't know or care which feed runs.
 */

import type { Chain, Holder } from "@thesis/shared";
import { config, useMock } from "../../config.js";
import { BirdeyeBaseData } from "./birdeye.js";
import { MockBaseData } from "./mock.js";
import { RealBaseData } from "./real.js";

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
  /** Token ticker (e.g. "DEGEN"). Returns empty string when unknown. */
  getTokenSymbol(address: string): Promise<string>;
}

let _adapterLogged = false;
export function createBaseDataAdapter(): BaseDataAdapter {
  if (useMock()) {
    if (!_adapterLogged) {
      console.log("[basedata] using MockBaseData");
      _adapterLogged = true;
    }
    return new MockBaseData();
  }
  if (config.baseData.birdeyeKey) {
    if (!_adapterLogged) {
      console.log(
        `[basedata] using BirdeyeBaseData (key len=${config.baseData.birdeyeKey.length})`,
      );
      _adapterLogged = true;
    }
    return new BirdeyeBaseData();
  }
  if (!_adapterLogged) {
    console.log("[basedata] using RealBaseData (DexScreener fallback — no BIRDEYE_API_KEY)");
    _adapterLogged = true;
  }
  return new RealBaseData();
}
