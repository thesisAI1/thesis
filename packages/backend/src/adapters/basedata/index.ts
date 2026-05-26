/**
 * Adapter: Base-chain token data — holders, liquidity, launchpad, rug checks.
 *
 *   - MockBaseData  (./mock.ts)  — fake snapshot, $0
 *   - RealBaseData  (./real.ts)  — DexScreener / GeckoTerminal / Birdeye
 *
 * Note: the real version can be built now — DexScreener and GeckoTerminal
 * have free public APIs.
 */

import type { Chain, Holder } from "@thesis/shared";
import { useMock } from "../../config.js";
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
  return useMock() ? new MockBaseData() : new RealBaseData();
}
