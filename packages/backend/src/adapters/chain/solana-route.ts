/**
 * Pure route-shaping + failure-classification helpers for the Solana protected
 * swap loop, plus the loop itself ({@link executeProtectedSwap}) with ALL of its
 * IO injected.
 *
 * Extracted from solana.real.ts so the recovery decisions — which previously LOST
 * ENTRIES to raw errors — are unit-tested without a live RPC or block engine,
 * matching jito.ts's "pure logic is tested, the fetch-backed wrappers are thin
 * IO" split.
 *
 * The bugs this module fixes (all observed in prod on 2026-06-04):
 *   - A Jito "cannot lock any vote accounts" reject was recovered by SHRINKING
 *     maxAccounts (64→48→32), which does NOT change which DEX Jupiter routes
 *     through — so the tainted route kept being re-selected, and the final
 *     constrained re-quote threw a raw `Jupiter /quote 400` that lost the entry.
 *     Fix: a vote-lock jumps straight to a DIRECT (single-hop) route, which dodges
 *     the multi-hop DEX that introduced the vote account; if even that has no
 *     route, the swap is ABANDONED cleanly (alarm), never thrown raw.
 *   - An ambiguous 5xx / network submit error ESCALATED the tip tier, burning the
 *     whole tip ladder on what is a transport problem (a bigger tip can't fix a
 *     server 500). Fix: 5xx/network errors retry the SAME tier as a transient
 *     transport blip (capped), and only a genuine "accepted but did not land"
 *     escalates the tip.
 *   - Route-ladder exhaustion (too-large / no-route) threw the underlying error
 *     raw instead of the clean MEV-abandon path. Fix: exhaustion abandons cleanly.
 */
import { tipForAttempt, type JitoSubmit, type JitoSubmitFailure, type TipFloorLamports } from "./jito.js";

/** Compile-time exhaustiveness guard. A `default:` branch that calls this fails to
 *  typecheck the moment a new {@link JitoSubmitFailure} kind is added without a
 *  matching case — turning "forgot to handle a kind" from a runtime surprise into a
 *  build error. (This file IS in `tsc -p packages/backend`; the test dir is not.) */
function assertNever(x: never): never {
  throw new Error(`unhandled JitoSubmit failure kind: ${JSON.stringify(x)}`);
}

/** A Jupiter route constraint. Empty = Jupiter's default (rich) routing. */
export interface RouteSpec {
  maxAccounts?: number;
  onlyDirectRoutes?: boolean;
}

/**
 * Ordered route ladder — progressively SIMPLER routes. Index 0 is the rich happy
 * path (Jupiter's default account budget); the last entry is the smallest
 * possible tx (single-hop, direct routes only). Recovery steps DOWN this ladder.
 *
 * The intermediate maxAccounts rungs shrink an over-large tx; the final
 * direct-routes rung both shrinks the tx AND forces a single-hop route that
 * sidesteps a multi-hop DEX that locked a vote account.
 */
export function buildRouteLadder(jupiterMaxAccounts: number): RouteSpec[] {
  return [
    { maxAccounts: jupiterMaxAccounts },
    { maxAccounts: 48 },
    { maxAccounts: 32 },
    { onlyDirectRoutes: true },
  ];
}

/** Human-readable label for a route step, for log messages. */
export function describeRoute(spec: RouteSpec): string {
  return spec.onlyDirectRoutes ? "direct-routes-only" : `maxAccounts=${spec.maxAccounts}`;
}

/** A route-shape failure: one a SIMPLER route might fix. */
export type RouteFailure = "too_large" | "vote_lock" | "no_route";

/**
 * Classify a thrown getQuote / buildSwapTx error into a route-shape failure, or
 * null when it is not route-shaped (the caller rethrows — e.g. a real RPC
 * outage).
 *
 *  - "too_large": the tx won't serialise into one 1232-byte Solana packet
 *    (`encoding overruns Uint8Array` from versioned-tx serialize, or the legacy
 *    "Transaction too large"). A SIMPLER route shrinks the tx; a bigger tip
 *    cannot fix tx SIZE.
 *  - "no_route": Jupiter has no route at the CURRENT constraint. This surfaces with
 *    several wordings, all meaning the same thing: parseJupiterQuote's
 *    `Jupiter: no route (...)` (jupiter-parse.ts — the pure quote validator), a raw
 *    `Jupiter /quote 400`, or `COULD_NOT_FIND_ANY_ROUTE`. Recoverable only mid-ladder
 *    (we constrained the route ourselves); at the happy-path step it is a genuine
 *    no-liquidity error and the caller propagates it.
 */
export function classifyRouteError(err: unknown): "too_large" | "no_route" | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (/encoding overruns|Transaction too large/i.test(msg)) return "too_large";
  // `Jupiter: no route` is parseJupiterQuote's exact throw wording — it must stay in
  // sync with jupiter-parse.ts so a no-liquidity quote isn't misread as null + lost.
  if (/Jupiter \/quote 400|Jupiter: no route|COULD_NOT_FIND_ANY_ROUTE|no routes? found/i.test(msg)) {
    return "no_route";
  }
  return null;
}

/**
 * Plan the next route after a route-shape failure. Returns the next ladder step
 * to re-quote, or null to ABANDON (no simpler route left → cleaner than thrashing
 * a dead route).
 *
 *  - "vote_lock": shrinking maxAccounts does NOT change which DEX Jupiter selects,
 *    so a tainted multi-hop route keeps getting re-picked (observed in prod: a
 *    maxAccounts=48 re-quote re-hit the same lock). Jump straight to the LAST
 *    (direct-routes-only) step, which forces a single-hop route that dodges the
 *    multi-hop DEX. Already at/after it → abandon.
 *  - "too_large" / "no_route": step ONE rung down to the next-simpler route.
 */
export function planRouteRecovery(
  ladderLen: number,
  currentStep: number,
  failure: RouteFailure,
): { step: number } | null {
  const last = ladderLen - 1;
  if (failure === "vote_lock") {
    return currentStep < last ? { step: last } : null;
  }
  return currentStep < last ? { step: currentStep + 1 } : null;
}

/**
 * How the swap loop should react to a FAILED submit, mapped 1:1 from the submit's
 * {@link JitoSubmitFailure} `kind`. The kind already encodes the double-fill-safety
 * of each reaction (see jito.ts), so no runtime guard is needed here — the unsafe
 * combinations the old bool-bag allowed (e.g. a route-reject that was "maybe
 * accepted", which a no-confirm reroute would double-fill over) are now
 * unrepresentable, and `assertNever` makes a newly-added kind a BUILD error.
 *
 *  - "reroute":    route_reject / too_large — both pre-submission validation rejects
 *                  (the tx provably never entered the engine), so re-quoting a
 *                  simpler/different route at the SAME tip WITHOUT a confirm is
 *                  double-fill-safe. The loop tells the two apart by `kind` (vote
 *                  lock → direct route; size → one rung down); a tip fixes neither.
 *  - "rate-limit": rate_limit (gateway 429) — provably never entered the engine, so
 *                  double-fill-safe to rebuild + resubmit the SAME tier (after a
 *                  backoff). Escalating the tip would burn budget on a rate limit.
 *  - "transport":  transport (ambiguous 5xx / network) — the already-sent tx MIGHT
 *                  have landed, so the caller confirms FIRST; if not, it retries the
 *                  SAME tier (a server error is not "tip too low" → no escalation).
 *  - "abandon":    abandon (deterministic 4xx ≠ 429, or an unparseable response) —
 *                  retrying / escalating changes nothing; confirm-then-give-up.
 *
 * A genuine "accepted but did not land" (tip too low) is NOT produced here — that is
 * the confirmOrExpire "expired" path, the only case that escalates the tip.
 */
export function classifySubmitFailure(
  submit: JitoSubmitFailure,
): "reroute" | "rate-limit" | "transport" | "abandon" {
  switch (submit.kind) {
    case "route_reject":
    case "too_large":
      return "reroute";
    case "rate_limit":
      return "rate-limit";
    case "transport":
      return "transport";
    case "abandon":
      return "abandon";
    default:
      return assertNever(submit);
  }
}

/** Exponential backoff (ms) for the Nth (1-based) transient retry, capped at 5s. */
export function transientBackoffMs(retry: number): number {
  return Math.min(5_000, 400 * 2 ** Math.min(Math.max(0, retry - 1), 4));
}

// --- The swap loop, with IO injected ------------------------------------------

/** One attempt's on-chain coordinates, enough to confirm landing-or-expiry. */
export interface BuiltTx {
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

/** The result of one quote→build→submit attempt. */
export interface SwapAttempt {
  outAmount: string;
  submit: JitoSubmit;
  built: BuiltTx;
}

/** Everything {@link executeProtectedSwap} needs — all IO is injected so the
 *  loop is unit-testable without a live RPC, Jupiter, or the block engine. */
export interface ProtectedSwapDeps {
  /** Live Jito tip floor, or null → safe defaults (see jito.tipForAttempt). */
  floor: TipFloorLamports | null;
  /** Tip-escalation tiers before abandoning (config.solana.jitoMaxAttempts). */
  maxAttempts: number;
  /** Hard tip ceiling, lamports (config.solana.jitoMaxTipLamports). */
  maxTipLamports: number;
  /** Same-tier retries for transient transport/rate-limit failures
   *  (config.solana.jitoMaxTransientRetries). */
  maxTransientRetries: number;
  /** Per-attempt tip floor — Helius Sender drops sub-minimum tips, so each rung
   *  is floored to this in sender mode; 0 in jito mode. */
  tipFloorLamports: number;
  /** The route ladder (see {@link buildRouteLadder}). */
  routeLadder: RouteSpec[];
  /** Do ONE attempt: quote at `routeSpec` → build at `tip` → submit. Throws a
   *  route-shape error (classified by {@link classifyRouteError}) or any other
   *  error to abort. NEVER broadcasts publicly. */
  attempt: (routeSpec: RouteSpec, tip: number) => Promise<SwapAttempt>;
  /** Await a submitted tx landing or its blockhash provably expiring. */
  confirmOrExpire: (built: BuiltTx) => Promise<"landed" | "expired">;
  /** Sleep (injected so tests run instantly). */
  sleep: (ms: number) => Promise<void>;
  /** Structured logger (info/warn). */
  log: { info: (m: string) => void; warn: (m: string) => void };
}

/** Landed swap, or an abandon reason for the caller to alarm + throw on. */
export type ProtectedSwapResult =
  | { ok: true; txHash: string; outAmount: string }
  | { ok: false; reason: string };

/**
 * MEV-protected swap loop: an escalating Jito tip with a fresh quote + bundle per
 * attempt, bounded by a short blockhash expiry (which is what prevents a
 * double-fill across retries — the next attempt fires only after the prior tx is
 * provably dead). NEVER falls back to the public RPC; on exhaustion it returns
 * `{ ok: false }` so the caller can alarm and throw.
 *
 * The control flow (and every double-fill guard) is faithfully ported from the
 * original inline loop; only the buggy branches changed — see the module header.
 */
export async function executeProtectedSwap(
  deps: ProtectedSwapDeps,
): Promise<ProtectedSwapResult> {
  const {
    floor,
    maxAttempts,
    maxTipLamports,
    maxTransientRetries,
    tipFloorLamports,
    routeLadder,
  } = deps;

  let lastReason = "no attempts made";
  // Separate budgets: a burst of 429s (rate limit) must not consume the retries
  // reserved for genuine 5xx/network transport blips, or vice versa. Each is
  // capped independently at maxTransientRetries.
  let rateLimitRetries = 0;
  let transportRetries = 0;
  let routeStep = 0;
  // `tier` is the tip-escalation level; it advances ONLY on a genuine "accepted
  // but did not land" (tip too low) — never on a rate-limit, transport error, or
  // route reject, none of which a higher tip can fix.
  let tier = 0;

  while (tier < maxAttempts) {
    const tip = Math.max(tipFloorLamports, tipForAttempt(floor, tier, { maxLamports: maxTipLamports }));

    let attempt: SwapAttempt;
    try {
      attempt = await deps.attempt(routeLadder[routeStep], tip);
    } catch (err) {
      const routeFail = classifyRouteError(err);
      // A no-route at the happy-path step (we did NOT constrain the route) is a
      // genuine no-liquidity error → propagate. Only a no-route we INDUCED by
      // shrinking the route mid-recovery is recoverable.
      if (routeFail === "no_route" && routeStep === 0) throw err;
      if (routeFail) {
        const next = planRouteRecovery(routeLadder.length, routeStep, routeFail);
        if (next) {
          routeStep = next.step;
          const label =
            routeFail === "too_large"
              ? "route too large for one packet — shrinking route"
              : "no route at this constraint — re-routing";
          deps.log.warn(
            `solana: ${label} (${describeRoute(routeLadder[routeStep])}) and re-quoting at tier ${tier + 1}`,
          );
          continue; // same tier, simpler route
        }
        lastReason = `route recovery exhausted (${routeFail}) at tip ${tip}`;
        break;
      }
      throw err; // not route-shaped (e.g. RPC outage) → abort the swap
    }

    const { submit, built, outAmount } = attempt;

    if (!submit.ok) {
      const action = classifySubmitFailure(submit);

      if (action === "reroute") {
        // A vote lock jumps straight to a direct route (shrinking maxAccounts does
        // NOT change which DEX Jupiter picks, so it re-hits the lock); a too-large
        // tx just needs a SMALLER one, so step one rung down. Either way the tip is
        // unchanged — neither is fixable by bidding higher.
        const failure: RouteFailure = submit.kind === "too_large" ? "too_large" : "vote_lock";
        const next = planRouteRecovery(routeLadder.length, routeStep, failure);
        if (next) {
          routeStep = next.step;
          deps.log.warn(
            `solana/jito: ${submit.reason} — re-routing (${describeRoute(routeLadder[routeStep])}) and re-quoting at tier ${tier + 1}`,
          );
          continue; // same tier, simpler route (a tip can't fix route shape/size)
        }
        lastReason = `jito submit failed (${submit.reason}) — route ladder exhausted at tip ${tip}`;
        break;
      }

      if (action === "rate-limit") {
        // 429 — provably never accepted, so the signed tx cannot land. Safe to
        // rebuild + resubmit the SAME tier (no confirm needed). Escalating the
        // tip here would just burn the budget on a rate limit.
        rateLimitRetries++;
        if (rateLimitRetries > maxTransientRetries) {
          lastReason = `rate-limited (${submit.reason}) — gave up after ${maxTransientRetries} retries`;
          break;
        }
        // retryAfterMs lives ONLY on the rate_limit kind (the type enforces this);
        // narrow by kind to read it, falling back to our own exponential backoff.
        const backoff =
          (submit.kind === "rate_limit" ? submit.retryAfterMs : undefined) ??
          transientBackoffMs(rateLimitRetries);
        deps.log.warn(
          `solana/jito: ${submit.reason} (rate limit) — backing off ${backoff}ms, retry ${rateLimitRetries}/${maxTransientRetries} at tier ${tier + 1}`,
        );
        await deps.sleep(backoff);
        continue; // same tier, same tip
      }

      if (action === "transport") {
        // Ambiguous 5xx / network: the already-sent tx MIGHT have landed →
        // confirm BEFORE rebuilding (never blind-rebuild over a possibly-live tx,
        // that could double-fill). A server error is NOT "tip too low", so do NOT
        // escalate the tier — retry the SAME tier as a transient transport blip.
        const outcome = await deps.confirmOrExpire(built);
        if (outcome === "landed") {
          deps.log.info(
            `solana/jito: swap landed despite submit error (${submit.reason}) at tier ${tier + 1} (tip ${tip}) — tx ${built.signature}`,
          );
          return { ok: true, txHash: built.signature, outAmount };
        }
        transportRetries++;
        if (transportRetries > maxTransientRetries) {
          lastReason = `transport error (${submit.reason}) — gave up after ${maxTransientRetries} retries at tip ${tip}`;
          break;
        }
        const backoff = transientBackoffMs(transportRetries);
        deps.log.warn(
          `solana/jito: ${submit.reason} (transport) — backing off ${backoff}ms, retry ${transportRetries}/${maxTransientRetries} at tier ${tier + 1}`,
        );
        await deps.sleep(backoff);
        continue; // same tier, same tip — do NOT escalate the tip on a 5xx
      }

      // action === "abandon": a deterministic reject. The tx might have been sent
      // (confirm before giving up), but escalating/retrying won't change a
      // deterministic reject.
      const outcome = await deps.confirmOrExpire(built);
      if (outcome === "landed") {
        deps.log.info(
          `solana/jito: swap landed despite reject (${submit.reason}) at tier ${tier + 1} — tx ${built.signature}`,
        );
        return { ok: true, txHash: built.signature, outAmount };
      }
      lastReason = `jito submit rejected (${submit.reason}) at tip ${tip}`;
      break;
    }

    // Submit accepted — await landing or blockhash expiry.
    const outcome = await deps.confirmOrExpire(built);
    if (outcome === "landed") {
      deps.log.info(
        `solana/jito: swap landed on tier ${tier + 1}/${maxAttempts} (tip ${tip} lamports) — tx ${built.signature}`,
      );
      return { ok: true, txHash: built.signature, outAmount };
    }

    // Accepted but expired without landing = tip too low → escalate the tier.
    lastReason = `bundle expired without landing at tip ${tip}`;
    deps.log.warn(`solana/jito: tier ${tier + 1}/${maxAttempts} — ${lastReason}, escalating`);
    tier++;
    // Tip already pinned at the cap → a further tier would bid the same and fail
    // the same way. Stop and abandon rather than burn attempts.
    if (tip >= maxTipLamports) {
      lastReason = `tip cap ${maxTipLamports} lamports reached, still not landing`;
      break;
    }
  }

  return { ok: false, reason: lastReason };
}
