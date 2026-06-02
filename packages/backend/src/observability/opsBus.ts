import { EventEmitter } from "node:events";
import type { Chain } from "@thesis/shared";

// ── Discriminated union of all ops events ──────────────────────────────────

/**
 * All variants share `at` — an ISO-8601 timestamp string (e.g. new Date().toISOString()).
 *
 * Numeric `*Eth` fields represent native-unit amounts (ETH on Base, SOL on Solana).
 * They are expected to be finite. Where the field represents a payment or proceeds
 * (amountEth, proceedsEth, toAuthorEth, totalProfitEth) it must also be non-negative.
 * PnL fields (profitEth, netPnlEth) may be negative (loss).
 */
export type OpsEvent =
  | { type: "trade:buy"; at: string; positionId: string; handle: string; amountEth: number; contract: string; chain: Chain }
  | { type: "trade:sell"; at: string; positionId: string; tier: number; proceedsEth: number; profitEth: number; chain: Chain }
  | { type: "position:close"; at: string; positionId: string; netPnlEth: number; reason: "tp" | "sl" | "manual" | "aging"; chain: Chain }
  | { type: "payout:sent"; at: string; path: "direct" | "escrow"; chain: Chain; handle: string; amountEth: number; wallet: string; txHash: string }
  | { type: "payout:failed"; at: string; chain: Chain; handle: string; amountEth: number; reason: string }
  | { type: "settle:done"; at: string; chain: Chain; positionId: string; toAuthorEth: number; totalProfitEth: number }
  | { type: "settle:summary"; at: string; positionId: string; handle: string; totalProfitEth: number; toAuthorEth: number; toPortfolioEth: number; toTeamEth: number; toBuybackEth: number; authorPaid: "direct" | "escrowed" }
  | { type: "settle:failed"; at: string; positionId: string; reason: string }
  | { type: "tweet:posted"; at: string; kind: string; replyId: string; postId: string }
  | { type: "error"; at: string; area: string; msg: string }
  | { type: "liveness:stale"; at: string; secondsSinceTick: number };

// ── Internal bus ────────────────────────────────────────────────────────────

const bus = new EventEmitter();
bus.setMaxListeners(50);

const EVENT = "ops";

export function publishOps(e: OpsEvent): void {
  bus.emit(EVENT, e);
}

export function subscribeOps(fn: (e: OpsEvent) => void): () => void {
  // Wrap in a try/catch so a throwing subscriber cannot crash the trading loop
  // (publishOps runs on the money path). Uses console.error directly — NOT logEvent —
  // to avoid recursive bus re-entry.
  const safe = (e: OpsEvent) => {
    try { fn(e); } catch (err) { console.error("[opsBus] subscriber threw:", err instanceof Error ? err.message : err); }
  };
  bus.on(EVENT, safe);
  return () => bus.off(EVENT, safe);
}
