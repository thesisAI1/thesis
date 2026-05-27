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
  /** Token ticker (e.g. "DEGEN"). Returns empty string when unknown. */
  getTokenSymbol(address: string): Promise<string>;
}

export function createBaseDataAdapter(): BaseDataAdapter {
  if (useMock()) return new MockBaseData();
  if (config.baseData.birdeyeKey) return new BirdeyeBaseData();
  return new RealBaseData();
}
