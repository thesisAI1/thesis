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

/**
 * JSON-RPC body for Helius Sender `sendTransaction`. Unlike a Jito bundle this is
 * a single base64 tx with `skipPreflight` (the tx is already built + simulated by
 * Jupiter) and `maxRetries: 0` (Sender does its own dual-route delivery; OUR loop
 * owns retry/escalation, so we don't want the RPC silently re-broadcasting and
 * muddying double-fill reasoning). Pure → testable.
 */
export function buildSenderSendTxBody(base64Tx: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "sendTransaction",
    params: [base64Tx, { encoding: "base64", skipPreflight: true, maxRetries: 0 }],
  });
}

/**
 * Outcome of a bundle / Sender submission (gateway ACCEPTANCE, NOT on-chain landing).
 *
 * On failure the `kind` discriminant tells the caller how to react safely — and,
 * crucially, makes illegal combinations UNREPRESENTABLE. The old bool-bag could
 * express e.g. a route-reject that was ALSO "maybe accepted", which would let the
 * caller rebuild over a possibly-live tx → double-fill; that guard now lives in the
 * type. Each kind encodes BOTH the reaction AND its double-fill-safety:
 *
 *  - "route_reject" — rejected for WHAT the route touches, not the tip (Jito refuses
 *                     bundles that lock a writable vote account, which some DEX hops
 *                     do). A pre-submission validation reject → the bundle provably
 *                     never entered the engine, so re-quoting a DIFFERENT (direct)
 *                     route at the SAME tip WITHOUT a confirm is double-fill-safe. No
 *                     tip can fix it.
 *  - "too_large"    — the tx won't fit one 1232-byte Solana packet (Helius Sender's
 *                     -32602 "base64 encoded too large"). Also a pre-submission
 *                     validation reject (never went out) → re-quoting a SIMPLER route
 *                     WITHOUT a confirm is safe. No tip can fix tx SIZE.
 *  - "rate_limit"   — gateway HTTP 429: provably rejected at the gateway, so the
 *                     signed tx cannot have landed. Safe to rebuild + resubmit the
 *                     SAME tier immediately (after `retryAfterMs` if supplied).
 *                     Escalating the tip would just burn budget on a rate limit.
 *  - "transport"    — ambiguous 5xx / network error: the request MIGHT have reached
 *                     the engine, so acceptance is UNKNOWN. The caller MUST confirm-
 *                     or-expire the already-sent tx BEFORE rebuilding (else a resend
 *                     could double-fill). A server error is not "tip too low" → do
 *                     NOT escalate the tip.
 *  - "abandon"      — a deterministic reject (4xx ≠ 429, or a malformed / unparseable
 *                     response). Retrying or escalating changes nothing; the caller
 *                     confirms-then-gives-up.
 *
 * There is deliberately NO kind for "accepted but did not land" — that is the
 * confirmOrExpire "expired" path, the only case that escalates the tip.
 */
export type JitoSubmit =
  | { ok: true; bundleId: string }
  | JitoSubmitFailure;

/**
 * The failure arm of {@link JitoSubmit} as a discriminated union, so illegal flag
 * combinations are unrepresentable (see the per-kind notes above). `retryAfterMs`
 * exists ONLY on `rate_limit` — a gateway-supplied Retry-After is meaningless on any
 * other kind, and the type now enforces that.
 */
export type JitoSubmitFailure =
  | { ok: false; kind: "route_reject"; reason: string }
  | { ok: false; kind: "too_large"; reason: string }
  | { ok: false; kind: "rate_limit"; reason: string; retryAfterMs?: number }
  | { ok: false; kind: "transport"; reason: string }
  | { ok: false; kind: "abandon"; reason: string };

/** Parse a Jito `sendBundle` JSON-RPC response. Pure → testable. A 2xx body that
 *  doesn't carry a bundle id is a deterministic, uninterpretable result — there is
 *  nothing to retry or re-route, so it classifies as "abandon". */
export function parseSendBundleResponse(json: unknown): JitoSubmit {
  if (!json || typeof json !== "object") return { ok: false, kind: "abandon", reason: "malformed_response" };
  const r = json as { result?: unknown; error?: { message?: string } };
  if (r.error) return { ok: false, kind: "abandon", reason: r.error.message ?? "jito_rpc_error" };
  if (typeof r.result !== "string") return { ok: false, kind: "abandon", reason: "missing_bundle_id" };
  return { ok: true, bundleId: r.result };
}

/** Parse an HTTP `Retry-After` header (delta-seconds or an HTTP date) into ms.
 *  Returns null when absent/unparseable. Pure → testable. */
export function parseRetryAfterMs(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, Math.round(secs * 1000));
  const when = Date.parse(header);
  if (Number.isFinite(when)) return Math.max(0, when - now);
  return null;
}

/**
 * Does a provider error/reason mean "this tx is too big to land in one 1232-byte
 * Solana packet" — as opposed to a tip-too-low or rate-limit problem? The size
 * limit bites in three places, each with its own wording, all meaning the same
 * thing (a bigger tip can NEVER help; only a SIMPLER route can):
 *   - local `tx.serialize()` overrun .... "encoding overruns Uint8Array"
 *   - legacy Transaction build .......... "Transaction too large"
 *   - Helius Sender reject .............. -32602 "... base64 encoded too large ..."
 * The Sender form was UNRECOGNISED in prod (2026-06-04), so sender-mode buys burned
 * the whole tip ladder on an unfixable size error and abandoned. Pure → testable.
 */
export function isTooLargeReason(reason: string): boolean {
  return /\bencoding overruns\b|\btransaction too large\b|\bbase64 encoded too large\b/i.test(reason);
}

/** Read a failed response's body and collapse it to a short one-line snippet for
 *  the failure `reason` — this is what surfaces the ACTUAL provider error (e.g.
 *  Helius Sender wraps a JSON-RPC `-32602 InvalidParams` inside an HTTP 500, which
 *  is invisible unless we read the body). Best-effort: never throws. */
async function readErrSnippet(res: Response): Promise<string> {
  const txt = await res.text().catch(() => "");
  const oneLine = txt.replace(/\s+/g, " ").trim();
  if (!oneLine) return "";
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine;
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
 * Client-side submit throttle. The free Jito block engine rate-limits sendBundle
 * per IP (~1 req/s); a burst (escalation ladder, or a buy racing a monitor sell)
 * trips HTTP 429. We reserve a time slot for each submission so concurrent
 * callers are spaced at least `jitoMinSubmitIntervalMs` apart. `nextSlotAtMs` is
 * read+written synchronously (before any await), so two overlapping callers can't
 * grab the same slot.
 */
let nextSlotAtMs = 0;
async function throttleSubmit(): Promise<void> {
  const interval = config.solana.jitoMinSubmitIntervalMs;
  if (interval <= 0) return;
  const now = Date.now();
  const slot = Math.max(now, nextSlotAtMs);
  nextSlotAtMs = slot + interval; // reserve atomically (no await between read/write)
  const wait = slot - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/**
 * Submit an already-signed transaction as a single-tx Jito bundle.
 *
 * ⚠ The caller MUST have embedded the tip transfer before signing — Jupiter does
 * this via prioritizationFeeLamports.jitoTipLamports. This function does not (and
 * cannot) inspect the tx; a bundle with no tip will be dropped.
 *
 * Returns acceptance by the block engine only. On-chain landing is confirmed
 * separately by polling the transaction signature. Failures are classified
 * (see {@link JitoSubmit}) so the caller can ride out a rate limit without
 * escalating the tip or risking a double-fill.
 */
export async function submitJitoBundle(tx: VersionedTransaction): Promise<JitoSubmit> {
  const base58Tx = bs58.encode(tx.serialize());
  await throttleSubmit();
  let res: Response;
  try {
    res = await fetch(config.solana.jitoBundleUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: buildSendBundleBody(base58Tx),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    // Network error / timeout — the request MAY have reached the block engine, so
    // acceptance is ambiguous → "transport" (the caller confirms before rebuilding).
    return { ok: false, kind: "transport", reason: (err as Error).message };
  }
  if (!res.ok) {
    const detail = await readErrSnippet(res);
    const tail = detail ? ` — ${detail}` : "";
    // Tx too big for one packet — a pre-submission validation reject (the bundle
    // never entered the engine, so the signed tx cannot land). No tip can fix tx
    // SIZE; only a simpler route can. "too_large" → the caller shrinks the route
    // (checked before any other branch).
    if (isTooLargeReason(detail)) {
      return { ok: false, kind: "too_large", reason: `jito_http_${res.status}${tail}` };
    }
    if (res.status === 429) {
      // Rejected at the gateway — the bundle provably never entered the engine, so
      // the signed tx cannot land. Safe to rebuild + resubmit immediately.
      return {
        ok: false,
        kind: "rate_limit",
        reason: `jito_http_429${tail}`,
        retryAfterMs: parseRetryAfterMs(res.headers.get("retry-after")) ?? undefined,
      };
    }
    if (res.status >= 500) {
      // Server-side error — ambiguous acceptance (the tx might have been taken).
      return { ok: false, kind: "transport", reason: `jito_http_${res.status}${tail}` };
    }
    // A "vote account lock" reject is route-fixable: THIS route happened to touch a
    // writable vote account (a quirk of some DEX hops), which the block engine
    // refuses. The bundle was provably rejected at validation — it never entered the
    // engine, so the signed tx cannot land. A bigger tip can't help; the caller must
    // re-quote a different route.
    if (/cannot lock any vote accounts/i.test(detail)) {
      return { ok: false, kind: "route_reject", reason: `jito_http_${res.status}${tail}` };
    }
    // Other 4xx — a deterministic reject; retrying the same thing won't help.
    return { ok: false, kind: "abandon", reason: `jito_http_${res.status}${tail}` };
  }
  return parseSendBundleResponse(await res.json().catch(() => null));
}

/**
 * Submit an already-signed tx via Helius Sender (`sendTransaction`, base64).
 *
 * The Sender alternative to {@link submitJitoBundle}: same embedded Jito tip (so
 * sandwich protection is preserved), but Helius dual-routes to Jito AND its
 * staked validator connections at ~50 TPS, sidestepping the free Jito engine's
 * ~1 req/s 429s that abandon entries. Caller MUST have floored the tip to
 * `senderMinTipLamports` (Sender drops sub-minimum tips).
 *
 * Returns gateway ACCEPTANCE only — on-chain landing is confirmed separately by
 * polling the signature (the JSON-RPC `result` is the signature, surfaced as
 * `bundleId`). Failures are classified identically to the Jito path so the swap
 * loop's 429-vs-ambiguous double-fill logic is unchanged.
 */
export async function submitSenderTransaction(tx: VersionedTransaction): Promise<JitoSubmit> {
  const base64Tx = Buffer.from(tx.serialize()).toString("base64");
  await throttleSubmit();
  let res: Response;
  try {
    res = await fetch(config.solana.senderUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: buildSenderSendTxBody(base64Tx),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    // Network error / timeout — request MAY have reached Sender; ambiguous →
    // "transport" (the caller confirms the already-sent tx before rebuilding).
    return { ok: false, kind: "transport", reason: (err as Error).message };
  }
  if (!res.ok) {
    const detail = await readErrSnippet(res);
    const tail = detail ? ` — ${detail}` : "";
    // Helius Sender wraps a too-big tx as HTTP 500 -32602 "base64 encoded too
    // large". It is a pre-submission validation reject (the tx never went out, so
    // it cannot land); no tip can fix size — only a simpler route can. "too_large"
    // so the caller shrinks the route instead of pointlessly escalating the tip
    // (which abandoned every sender-mode buy in prod on 2026-06-04). Checked before
    // the generic 5xx branch, which would otherwise mark it ambiguous transport.
    if (isTooLargeReason(detail)) {
      return { ok: false, kind: "too_large", reason: `sender_http_${res.status}${tail}` };
    }
    if (res.status === 429) {
      // Rejected at the gateway before submission — the tx provably never went out,
      // so it cannot land. Safe to rebuild + resubmit immediately.
      return {
        ok: false,
        kind: "rate_limit",
        reason: `sender_http_429${tail}`,
        retryAfterMs: parseRetryAfterMs(res.headers.get("retry-after")) ?? undefined,
      };
    }
    if (res.status >= 500) {
      // Helius Sender wraps client errors (e.g. -32602 InvalidParams, bad tip) in
      // an HTTP 500, so the snippet is the only signal of WHY — surface it. Ambiguous
      // acceptance → "transport".
      return { ok: false, kind: "transport", reason: `sender_http_${res.status}${tail}` };
    }
    return { ok: false, kind: "abandon", reason: `sender_http_${res.status}${tail}` };
  }
  return parseSendBundleResponse(await res.json().catch(() => null));
}
