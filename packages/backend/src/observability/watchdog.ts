import { config } from "../config.js";
import { publishOps } from "./opsBus.js";

// ── State ───────────────────────────────────────────────────────────────────

let lastTick: number = Date.now();

// ── API ─────────────────────────────────────────────────────────────────────

export function markTick(atMs: number = Date.now()): void {
  lastTick = atMs;
}

export function checkLiveness(
  nowMs: number = Date.now(),
  staleSec: number = config.observability.heartbeatStaleSec,
  pollSec: number = config.service.pollIntervalSec,
): void {
  // staleSec 0 = auto-derive a live-safe window from the poll interval, so it can
  // never be shorter than a normal poll cycle (which would false-fire in live mode).
  const effective = staleSec > 0 ? staleSec : Math.max(90, pollSec * 3);

  const elapsedSec = (nowMs - lastTick) / 1000;
  if (elapsedSec > effective) {
    publishOps({
      type: "liveness:stale",
      at: new Date().toISOString(),
      secondsSinceTick: Math.round(elapsedSec),
    });
  }
}
