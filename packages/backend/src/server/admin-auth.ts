/**
 * Admin authentication for the /admin/* money-moving endpoints.
 *
 * Pure + side-effect-free (no `res`, no I/O) so it is fully unit-testable; the
 * HTTP layer turns a denial into a response. Hardens three things the old
 * inline `header !== secret` check got wrong, WITHOUT changing the contract for
 * a legitimate caller (correct secret in `x-admin-secret` still works exactly
 * as before — so merging this cannot break production):
 *
 *   1. Constant-time comparison. `!==` short-circuits at the first differing
 *      character, leaking via response timing how many leading chars were
 *      right — a remote attacker can recover the secret byte by byte. We hash
 *      both sides and compare with crypto.timingSafeEqual, which takes the same
 *      time regardless of where they differ (and the hash equalises length, so
 *      timingSafeEqual never throws and the secret's length never leaks).
 *
 *   2. Brute-force lockout. Counts FAILED attempts per client IP and locks that
 *      IP out after MAX_FAILS within FAIL_WINDOW_MS. A correct secret is never
 *      counted, so a legitimate operator is never rate-limited.
 *
 *   3. Optional IP allow-list. When ADMIN_ALLOWED_IPS is set, /admin/* is only
 *      reachable from those IPs. DEFAULT EMPTY = no restriction = current
 *      behaviour, so the merge is non-breaking; the operator opts in (e.g. to
 *      "127.0.0.1,::1" once an SSH tunnel is in place) when ready.
 *
 * Fail-closed: when ADMIN_SECRET is unset, every admin call is denied (503) —
 * unchanged from before.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { config } from "../config.js";

/** How long a burst of failed attempts is remembered, and how many are
 *  tolerated within it before that IP is locked out. */
export const FAIL_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILS = 10;

/** Per-IP failed-attempt tracker (in-memory; resets on restart — fine for a
 *  brute-force speed bump on a single-process server). */
const failures = new Map<string, { count: number; firstAt: number }>();

/** HTTP status codes a denied admin request can carry. A literal union (rather
 *  than `number`) makes the contract self-documenting and lets the compiler
 *  catch a wrong code at the sendJson call site. */
export type AdminDenyStatus = 401 | 403 | 429 | 503;

/** The verdict from checkAdmin — a discriminated union so the caller narrows
 *  cleanly: `if (!gate.ok) sendJson(res, gate.status, …)`. */
export type AdminGate =
  | { ok: true }
  | { ok: false; status: AdminDenyStatus; error: string };

/** Best-effort client IP. Behind a trusted reverse proxy this is the proxy's
 *  address; the IP allow-list is intended for the localhost/SSH-tunnel case
 *  where that is exactly what we want to match. */
export function clientIp(req: IncomingMessage): string {
  return req.socket?.remoteAddress ?? "unknown";
}

function sha256(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

/** Constant-time string equality. Hashing first equalises length so
 *  timingSafeEqual never throws and the secret length never leaks. */
export function constantTimeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

function recordFailure(ip: string): void {
  const now = nowMs();
  const rec = failures.get(ip);
  if (!rec || now - rec.firstAt >= FAIL_WINDOW_MS) {
    failures.set(ip, { count: 1, firstAt: now });
  } else {
    rec.count += 1;
  }
}

function isLockedOut(ip: string): boolean {
  const rec = failures.get(ip);
  if (!rec) return false;
  if (nowMs() - rec.firstAt >= FAIL_WINDOW_MS) {
    failures.delete(ip); // window elapsed — forgive
    return false;
  }
  return rec.count >= MAX_FAILS;
}

/** Injectable clock so tests can exercise the lockout window deterministically.
 *  Defaults to Date.now in production. */
let nowMs: () => number = () => Date.now();

/** @internal TEST ONLY — overrides the lockout clock. These hooks can reset the
 *  brute-force state, so they must never be reachable in production; they throw
 *  if NODE_ENV is "production". */
export function __setClockForTest(fn: () => number): void {
  assertNotProduction();
  nowMs = fn;
}
/** @internal TEST ONLY — clears the per-IP failure tracker + restores the clock. */
export function __resetAuthStateForTest(): void {
  assertNotProduction();
  failures.clear();
  nowMs = () => Date.now();
}
function assertNotProduction(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("admin-auth test hooks must not be called in production");
  }
}

/**
 * Decide whether an /admin/* request is authorized. Pure: no response is sent,
 * no logging — the caller acts on the verdict.
 */
export function checkAdmin(req: IncomingMessage): AdminGate {
  const secret = config.server.adminSecret;
  if (!secret) {
    return { ok: false, status: 503, error: "admin endpoints disabled (ADMIN_SECRET not set)" };
  }

  const ip = clientIp(req);

  // Optional IP allow-list (opt-in; empty list = no restriction).
  const allow = config.server.adminAllowedIps;
  if (allow.length > 0 && !allow.includes(ip)) {
    return { ok: false, status: 403, error: "forbidden" };
  }

  // Brute-force lockout (counts only failed attempts).
  if (isLockedOut(ip)) {
    return { ok: false, status: 429, error: "too many attempts — try again later" };
  }

  const header = req.headers["x-admin-secret"];
  const provided = Array.isArray(header) ? (header[0] ?? "") : (header ?? "");
  if (!provided || !constantTimeEqual(provided, secret)) {
    recordFailure(ip);
    return { ok: false, status: 401, error: "unauthorized" };
  }

  // Success — clear any prior failures for this IP.
  failures.delete(ip);
  return { ok: true };
}
