import { EventEmitter } from "node:events";

// ── Discriminated union of all ops events ──────────────────────────────────

export type OpsEvent =
  | { type: "trade:buy"; at: string; positionId: string; handle: string; amountEth: number; contract: string }
  | { type: "trade:sell"; at: string; positionId: string; tier: number; proceedsEth: number; profitEth: number }
  | { type: "position:close"; at: string; positionId: string; netPnlEth: number; reason: "tp" | "sl" | "manual" }
  | { type: "payout:sent"; at: string; handle: string; amountEth: number; wallet: string; txHash: string }
  | { type: "payout:failed"; at: string; handle: string; amountEth: number; reason: string }
  | { type: "settle:done"; at: string; positionId: string; toAuthorEth: number; totalProfitEth: number }
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
  bus.on(EVENT, fn);
  return () => bus.off(EVENT, fn);
}
