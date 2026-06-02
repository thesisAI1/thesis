/**
 * Enrichment helper — turns a thin ops event (positionId / contract) into
 * display-ready fields for a public Telegram message.
 *
 * Heavy use of dependency injection so the module is testable offline without
 * hitting the network or the store singleton.
 */

import type { Chain, Position } from "@thesis/shared";
import { nativeSymbol } from "@thesis/shared";
import type { Store } from "../../store/index.js";
import { getStore } from "../../store/index.js";
import { createBaseDataAdapter } from "../basedata/index.js";

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the percentage gain rounded to an integer.
 * Guards against division by zero → 0.
 * Negative netPnl → negative %.
 */
export function pnlPct(netPnlEth: number, entryEth: number): number {
  if (entryEth <= 0) return 0;
  return Math.round((netPnlEth / entryEth) * 100);
}

// ── Symbol cache ──────────────────────────────────────────────────────────────

/** Module-level in-memory cache: lowercased contract → ticker symbol. */
const symbolCache = new Map<string, string>();

/** Clear the cache (for test isolation). */
export function clearSymbolCache(): void {
  symbolCache.clear();
}

/**
 * Resolves a token ticker with a module-level in-memory cache.
 * On cache miss, calls `deps.getSymbol` (or the real adapter).
 * On throw OR empty result, returns `""` and does NOT cache the failure.
 *
 * `cacheOnly`: never hit the network — return "" on a cache miss. Used by the
 * public `/check` command so a stranger can't fan a single message out into
 * dozens of external symbol lookups against the BaseData adapter that the live
 * trading loop shares (only tokens already seen by the notifier/other commands
 * resolve; everything else reads as unknown).
 */
export async function resolveSymbol(
  contract: string,
  chain: Chain,
  deps?: { getSymbol?: (c: string, chain: Chain) => Promise<string>; cacheOnly?: boolean },
): Promise<string> {
  const key = contract.toLowerCase();
  if (symbolCache.has(key)) {
    return symbolCache.get(key)!;
  }
  if (deps?.cacheOnly) return "";

  const fetcher =
    deps?.getSymbol ??
    ((c: string, ch: Chain) => createBaseDataAdapter(ch).getTokenSymbol(c));

  try {
    const symbol = await fetcher(contract, chain);
    if (!symbol) {
      // Empty string — don't cache
      return "";
    }
    symbolCache.set(key, symbol);
    return symbol;
  } catch {
    // Failure — don't cache, return empty
    return "";
  }
}

// ── Enrichment type ───────────────────────────────────────────────────────────

export type PositionEnrichment =
  | {
      found: true;
      symbol: string;
      chain: Chain;
      unit: string;
      entryEth: number;
      contract: string;
      authorHandle: string;
    }
  | { found: false };

// ── Main enrichment function ──────────────────────────────────────────────────

/**
 * Fetches a position by id and resolves display-ready fields.
 * Never throws — symbol failure yields `symbol: ""`.
 */
export async function enrichPosition(
  positionId: string,
  deps?: {
    store?: Store;
    getSymbol?: (c: string, chain: Chain) => Promise<string>;
  },
): Promise<PositionEnrichment> {
  const store = deps?.store ?? getStore();
  const positions: Position[] = await store.getAllPositions();
  const position = positions.find((p) => p.id === positionId);

  if (!position) {
    return { found: false };
  }

  const { order, authorHandle } = position;
  const symbol = await resolveSymbol(order.contractAddress, order.chain, deps);
  const unit = nativeSymbol(order.chain);

  return {
    found: true,
    symbol,
    chain: order.chain,
    unit,
    entryEth: order.amountInEth,
    contract: order.contractAddress,
    authorHandle,
  };
}
