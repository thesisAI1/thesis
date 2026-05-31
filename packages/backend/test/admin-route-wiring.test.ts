/**
 * PR5 follow-up — admin ROUTE WIRING (integration).
 *
 * admin-auth.test.ts proves the pure checkAdmin() verdict is correct. This file
 * proves the thing that pure test CANNOT: that checkAdmin is actually WIRED into
 * every /admin/* handler. That distinction is not academic — commit 353cbfb
 * shipped claiming "all 7 handlers" were gated when only 2 were; a unit test of
 * checkAdmin passes whether or not a handler ever calls it. Only driving the
 * real router (handle) with an unauthenticated request catches a missing gate.
 *
 * Strategy: with ADMIN_SECRET set but NO x-admin-secret header, a gated route
 * returns 401. An UNgated route would fall through to readBody()/JSON.parse()
 * and return 400 (or hang → test timeout). So asserting 401 on every route is a
 * precise tripwire: delete a checkAdmin line anywhere and this test goes red.
 */

import "./helpers/isolate-store.js"; // pins mock mode (no network) before config loads
import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "../src/config.js";
import { handle } from "../src/server/index.js";
import { __resetAuthStateForTest } from "../src/server/admin-auth.js";

/** Every money-moving admin route. Keep in sync with the dispatch table in
 *  server/index.ts — a new /admin/* route added without auth must break here. */
const ADMIN_ROUTES = [
  "/admin/test-swap",
  "/admin/settle-stuck-payout",
  "/admin/reset-position-state",
  "/admin/rebuy-position",
  "/admin/backfill-entry-mc",
  "/admin/force-close-position",
  "/admin/repost-close-announcement",
] as const;

/** Minimal IncomingMessage stub. A distinct IP per route keeps every probe a
 *  first failure, so the brute-force lockout (10/IP) never turns a 401 into a
 *  429 mid-loop — the test stays independent of MAX_FAILS. */
function unauthReq(path: string, ip: string): IncomingMessage {
  return {
    url: path,
    method: "POST",
    headers: {}, // no x-admin-secret → unauthenticated
    socket: { remoteAddress: ip },
  } as unknown as IncomingMessage;
}

/** Capture what sendJson(res, status, body) writes. */
function captureRes(): {
  res: ServerResponse;
  result: () => { status: number; body: { ok?: boolean; error?: string } };
} {
  let status = 0;
  let body: { ok?: boolean; error?: string } = {};
  const res = {
    headersSent: false,
    writeHead(s: number) {
      status = s;
      (this as { headersSent: boolean }).headersSent = true;
      return this;
    },
    end(chunk?: string) {
      if (chunk) body = JSON.parse(chunk);
      return this;
    },
  } as unknown as ServerResponse;
  return { res, result: () => ({ status, body }) };
}

test("every /admin/* route rejects an unauthenticated request (checkAdmin is wired)", async () => {
  const s = config.server as { adminSecret: string; adminAllowedIps: string[] };
  const prevSecret = s.adminSecret;
  const prevAllow = s.adminAllowedIps;
  // Enable the endpoints (unset secret → 503 disabled, which would mask wiring)
  // and clear any allow-list so the only thing that can deny is the auth check.
  s.adminSecret = "test-admin-secret";
  s.adminAllowedIps = [];
  __resetAuthStateForTest();

  try {
    let i = 0;
    for (const path of ADMIN_ROUTES) {
      const { res, result } = captureRes();
      await handle(unauthReq(path, `203.0.113.${i++}`), res);
      const { status, body } = result();
      assert.equal(
        status,
        401,
        `${path} must return 401 unauthenticated — got ${status}. A missing ` +
          `checkAdmin would fall through to the handler body (400/200/hang).`,
      );
      assert.equal(body.ok, false, `${path} should report { ok: false }`);
    }
  } finally {
    s.adminSecret = prevSecret;
    s.adminAllowedIps = prevAllow;
    __resetAuthStateForTest();
  }
});

test("a wrong secret is also rejected on every /admin/* route", async () => {
  const s = config.server as { adminSecret: string; adminAllowedIps: string[] };
  const prevSecret = s.adminSecret;
  const prevAllow = s.adminAllowedIps;
  s.adminSecret = "the-real-secret";
  s.adminAllowedIps = [];
  __resetAuthStateForTest();

  try {
    let i = 0;
    for (const path of ADMIN_ROUTES) {
      const { res, result } = captureRes();
      const req = {
        url: path,
        method: "POST",
        headers: { "x-admin-secret": "not-the-secret" },
        socket: { remoteAddress: `198.51.100.${i++}` },
      } as unknown as IncomingMessage;
      await handle(req, res);
      assert.equal(result().status, 401, `${path} must reject a wrong secret`);
    }
  } finally {
    s.adminSecret = prevSecret;
    s.adminAllowedIps = prevAllow;
    __resetAuthStateForTest();
  }
});
