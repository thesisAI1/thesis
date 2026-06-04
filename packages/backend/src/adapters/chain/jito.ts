/**
 * Jito MEV-protection helpers for Solana swaps.
 *
 * Adapted (simplified) from swipefun's infra/jito + sender/jitoPath. Solana has
 * no public mempool like Ethereum, but Jito-Solana validators run a block engine
 * where searchers can see and sandwich pending transactions. The defence:
 *   1. submit the swap PRIVATELY as a Jito bundle (not via public RPC), and
 *   2. pay a tip so a validator includes + orders our bundle, leaving no room
 *      for a sandwich to wrap it.
 *
 * The tip transfer itself is embedded by Jupiter at /swap build time
 * (prioritizationFeeLamports.jitoTipLamports), so this module never mutates the
 * transaction — it only DECIDES the tip and SUBMITS the signed tx.
 *
 * Pure functions (parse/choose/build) are unit-tested without a live RPC; the
 * two `fetch`-backed wrappers are thin IO.
 */
import bs58 from "bs58";
import type { VersionedTransaction } from "@solana/web3.js";
import { config } from "../../config.js";
import { log } from "../../util/log.js";

const LAMPORTS_PER_SOL = 1e9;

/** Recently-landed-tip percentiles from Jito's tip_floor API, in LAMPORTS. */
export interface TipFloorLamports {
  p50: number;
  p75: number;
  p95: number;
}

/**
 * Conservative fallback tips (lamports) used when the tip-floor API is
 * unreachable — enough to land in normal conditions without overpaying.
 * Mirrors swipefun's SAFE_DEFAULTS.
 */
export const SAFE_DEFAULT_TIP_FLOOR: TipFloorLamports = {
  p50: 10_000,
  p75: 1_000_000,
  p95: 5_000_000,
};

/** Jito drops bundles whose tip is below ~1000 lamports — never tip less. */
export const MIN_TIP_LAMPORTS = 1_000;

/** Short cache TTL for the tip floor — the market moves slowly second-to-second. */
const TIP_FLOOR_TTL_MS = 10_000;

// --- Pure helpers (unit-tested) ------------------------------------------------

/**
 * Parse a Jito `/bundles/tip_floor` response into a lamports percentile map.
 * The API returns an array whose first item carries SOL-denominated floats; we
 * convert to integer lamports. Returns null on any shape mismatch so the caller
 * can fall back to {@link SAFE_DEFAULT_TIP_FLOOR}.
 */
export function parseTipFloor(json: unknown): TipFloorLamports | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  const item = json[0];
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const p50 = o.landed_tips_50th_percentile;
  const p75 = o.landed_tips_75th_percentile;
  const p95 = o.landed_tips_95th_percentile;
  if (typeof p50 !== "number" || typeof p75 !== "number" || typeof p95 !== "number") {
    return null;
  }
  const toLamports = (sol: number): number => Math.round(sol * LAMPORTS_PER_SOL);
  return { p50: toLamports(p50), p75: toLamports(p75), p95: toLamports(p95) };
}

/**
 * The Jito tip (lamports) for retry attempt `attempt` (0 = first, cheapest try).
 *
 * Policy (operator-chosen): START LOW, ESCALATE. "Didn't land" almost always
 * means "tip too low", so each retry bids higher. We never broadcast on the
 * public RPC — the caller escalates up to `maxLamports`, then ABANDONS the swap
 * rather than expose it. The ladder is the live tip floor's own percentiles:
 *
 *   attempt 0 → p50  (median landed tip — cheap, lands in calm markets)
 *   attempt 1 → p75  (competitive)
 *   attempt 2 → p95  (aggressive — beats almost all contending bundles)
 *   attempt 3+ → p95 doubled each further step (tip-market spike territory)
 *
 * Every rung is clamped to [MIN_TIP_LAMPORTS, maxLamports]. When `floor` is null
 * (tip-floor API down) we ladder off SAFE_DEFAULT_TIP_FLOOR so a swap still
 * escalates sanely.
 *
 * @param floor   live tip market, or null → use SAFE_DEFAULT_TIP_FLOOR
 * @param attempt 0-based retry index
 * @param opts.maxLamports operator's hard ceiling (config.solana.jitoMaxTipLamports)
 * @returns integer lamports to embed as the Jito tip for this attempt
 */
export function tipForAttempt(
  floor: TipFloorLamports | null,
  attempt: number,
  opts: { maxLamports: number },
): number {
  const f = floor ?? SAFE_DEFAULT_TIP_FLOOR;
  const ladder = [f.p50, f.p75, f.p95];
  const i = Math.max(0, Math.floor(attempt));
  // Within the ladder, step through percentiles; beyond it, double p95 each step.
  const base = i < ladder.length ? ladder[i] : f.p95 * 2 ** (i - ladder.length + 1);
  const tip = Math.round(base);
  // maxLamports >= MIN_TIP_LAMPORTS is enforced by validateConfig, so the cap
  // always wins cleanly over the floor (no MIN-vs-cap inversion).
  return Math.max(MIN_TIP_LAMPORTS, Math.min(tip, opts.maxLamports));
}

/** JSON-RPC body for Jito `sendBundle` (single-tx bundle). Pure → testable. */
export function buildSendBundleBody(base58Tx: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [[base58Tx]],
  });
}

/** Outcome of a Jito bundle submission (acceptance, NOT on-chain landing). */
export type JitoSubmit =
  | { ok: true; bundleId: string }
  | { ok: false; reason: string };

/** Parse a Jito `sendBundle` JSON-RPC response. Pure → testable. */
export function parseSendBundleResponse(json: unknown): JitoSubmit {
  if (!json || typeof json !== "object") return { ok: false, reason: "malformed_response" };
  const r = json as { result?: unknown; error?: { message?: string } };
  if (r.error) return { ok: false, reason: r.error.message ?? "jito_rpc_error" };
  if (typeof r.result !== "string") return { ok: false, reason: "missing_bundle_id" };
  return { ok: true, bundleId: r.result };
}

// --- IO wrappers (thin) --------------------------------------------------------

let tipFloorCache: { at: number; floor: TipFloorLamports } | null = null;

/** Clear the on-demand tip-floor cache. For tests that mock `fetch` — the cache
 *  is module-level, so without this a prior call's value bleeds across tests. */
export function _resetTipFloorCacheForTesting(): void {
  tipFloorCache = null;
}

/**
 * Fetch the Jito tip floor on demand, cached for {@link TIP_FLOOR_TTL_MS}. On any
 * failure (network, non-200, bad shape) logs a warning and returns
 * {@link SAFE_DEFAULT_TIP_FLOOR} — a swap must never block on the tip oracle.
 */
export async function fetchTipFloor(now: number = Date.now()): Promise<TipFloorLamports> {
  if (tipFloorCache && now - tipFloorCache.at < TIP_FLOOR_TTL_MS) {
    return tipFloorCache.floor;
  }
  try {
    const res = await fetch(config.solana.jitoTipFloorUrl, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) throw new Error(`tip_floor ${res.status}`);
    const floor = parseTipFloor(await res.json());
    if (!floor) throw new Error("tip_floor parse failed");
    tipFloorCache = { at: now, floor };
    return floor;
  } catch (err) {
    log.warn(
      `solana/jito: tip floor unavailable (${(err as Error).message}) — using safe defaults`,
    );
    return SAFE_DEFAULT_TIP_FLOOR;
  }
}

/**
 * Submit an already-signed transaction as a single-tx Jito bundle.
 *
 * ⚠ The caller MUST have embedded the tip transfer before signing — Jupiter does
 * this via prioritizationFeeLamports.jitoTipLamports. This function does not (and
 * cannot) inspect the tx; a bundle with no tip will be dropped.
 *
 * Returns acceptance by the block engine only. On-chain landing is confirmed
 * separately by polling the transaction signature.
 */
export async function submitJitoBundle(tx: VersionedTransaction): Promise<JitoSubmit> {
  const base58Tx = bs58.encode(tx.serialize());
  let res: Response;
  try {
    res = await fetch(config.solana.jitoBundleUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: buildSendBundleBody(base58Tx),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  if (!res.ok) return { ok: false, reason: `jito_http_${res.status}` };
  return parseSendBundleResponse(await res.json().catch(() => null));
}
