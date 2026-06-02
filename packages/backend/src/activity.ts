/**
 * In-memory ring buffer of user-facing events ("ticker tape" source).
 *
 * Producers (monitor, bursar, endowment) call recordActivity() in their hot
 * paths to surface what just happened. The dashboard API consumes the buffer
 * once per request and includes the last N items in its JSON payload, where
 * the frontend renders them as a scrolling marquee at the top of the page.
 *
 * Persistence is in-memory only — a process restart wipes the buffer. That's
 * deliberate: the ticker is "what just happened" (last few hours at most),
 * not historical record. Persistent history lives in Position / Distribution
 * stores already.
 *
 * Lives in its own module (not server/index.ts) so producers can import it
 * without dragging in the HTTP server's dependency graph.
 */

export interface ActivityItem {
  at: string; // ISO timestamp
  kind: "buy" | "tp" | "sl" | "manual" | "aging" | "burn" | "skip";
  /** Short human-readable summary, pre-formatted by the caller (so the ticker
   *  can render it without per-item branching). e.g. "@author funded 0.02 Ξ"
   *  or "@author hit TP1 (+100%)". */
  summary: string;
  /** Optional context for accent colouring / linking. */
  authorHandle?: string;
  tokenSymbol?: string;
  positionId?: string;
  /** ETH amount (for wins/burns/payouts). Used by the frontend to colour the
   *  item green when positive. */
  amountEth?: number;
}

const ACTIVITY_BUFFER_SIZE = 50;
const activityBuffer: ActivityItem[] = [];

export function recordActivity(item: Omit<ActivityItem, "at">): void {
  activityBuffer.unshift({ ...item, at: new Date().toISOString() });
  if (activityBuffer.length > ACTIVITY_BUFFER_SIZE) {
    activityBuffer.length = ACTIVITY_BUFFER_SIZE;
  }
}

export function getRecentActivity(limit = 50): ActivityItem[] {
  return activityBuffer.slice(0, Math.min(limit, ACTIVITY_BUFFER_SIZE));
}
