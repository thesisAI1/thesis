/**
 * PR5 — admin auth hardening (server/admin-auth.ts).
 *
 * checkAdmin is pure, so we test it directly with a stub request. Covers:
 * constant-time equality correctness, fail-closed when the secret is unset,
 * the opt-in IP allow-list, and the brute-force lockout (counts failures only,
 * never a correct secret).
 */

import "./helpers/isolate-store.js"; // pins mock mode (no network) before config loads
import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { config } from "../src/config.js";
import {
  checkAdmin,
  constantTimeEqual,
  MAX_FAILS,
  __resetAuthStateForTest,
  __setClockForTest,
} from "../src/server/admin-auth.js";

/** Minimal IncomingMessage stub: just the header + remote IP checkAdmin reads. */
function req(secretHeader: string | undefined, ip = "1.2.3.4"): IncomingMessage {
  return {
    headers: secretHeader === undefined ? {} : { "x-admin-secret": secretHeader },
    socket: { remoteAddress: ip },
  } as unknown as IncomingMessage;
}

function withAdminConfig(
  opts: { secret?: string; allowedIps?: string[] },
  fn: () => void,
): void {
  const s = config.server as { adminSecret: string; adminAllowedIps: string[] };
  const prevSecret = s.adminSecret;
  const prevAllow = s.adminAllowedIps;
  s.adminSecret = opts.secret ?? "";
  s.adminAllowedIps = opts.allowedIps ?? [];
  __resetAuthStateForTest();
  try {
    fn();
  } finally {
    s.adminSecret = prevSecret;
    s.adminAllowedIps = prevAllow;
    __resetAuthStateForTest();
  }
}

test("constantTimeEqual is correct for equal and unequal strings", () => {
  assert.equal(constantTimeEqual("hunter2", "hunter2"), true);
  assert.equal(constantTimeEqual("hunter2", "hunter3"), false);
  assert.equal(constantTimeEqual("short", "a-much-longer-secret"), false);
});

test("denies with 503 when ADMIN_SECRET is unset (fail-closed)", () => {
  withAdminConfig({ secret: "" }, () => {
    const gate = checkAdmin(req("anything"));
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.equal(gate.status, 503);
  });
});

test("allows the correct secret, denies a wrong one", () => {
  withAdminConfig({ secret: "s3cr3t-long-random" }, () => {
    assert.equal(checkAdmin(req("s3cr3t-long-random")).ok, true);
    const bad = checkAdmin(req("wrong"));
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.status, 401);
  });
});

test("missing header is denied 401, not crashed", () => {
  withAdminConfig({ secret: "s3cr3t" }, () => {
    const gate = checkAdmin(req(undefined));
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.equal(gate.status, 401);
  });
});

test("IP allow-list: empty = no restriction (non-breaking default)", () => {
  withAdminConfig({ secret: "s3cr3t", allowedIps: [] }, () => {
    assert.equal(checkAdmin(req("s3cr3t", "9.9.9.9")).ok, true);
  });
});

test("IP allow-list: when set, only listed IPs pass (403 otherwise)", () => {
  withAdminConfig({ secret: "s3cr3t", allowedIps: ["127.0.0.1", "::1"] }, () => {
    assert.equal(checkAdmin(req("s3cr3t", "127.0.0.1")).ok, true);
    const blocked = checkAdmin(req("s3cr3t", "9.9.9.9"));
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.status, 403);
  });
});

test("brute-force lockout after MAX_FAILS wrong attempts (429)", () => {
  withAdminConfig({ secret: "s3cr3t" }, () => {
    for (let i = 0; i < MAX_FAILS; i++) {
      const g = checkAdmin(req("wrong", "5.5.5.5"));
      assert.equal(g.ok, false);
      if (!g.ok) assert.equal(g.status, 401); // still just unauthorized
    }
    const locked = checkAdmin(req("wrong", "5.5.5.5"));
    assert.equal(locked.ok, false);
    if (!locked.ok) assert.equal(locked.status, 429, "should be locked out now");
    // Even the CORRECT secret is refused while locked out.
    const lockedCorrect = checkAdmin(req("s3cr3t", "5.5.5.5"));
    assert.equal(lockedCorrect.ok, false);
  });
});

test("a correct secret never counts toward lockout", () => {
  withAdminConfig({ secret: "s3cr3t" }, () => {
    // Many successful calls must never trip the limiter.
    for (let i = 0; i < MAX_FAILS * 3; i++) {
      assert.equal(checkAdmin(req("s3cr3t", "7.7.7.7")).ok, true);
    }
  });
});

test("lockout window expires (forgive after FAIL_WINDOW_MS)", () => {
  withAdminConfig({ secret: "s3cr3t" }, () => {
    let clock = 1_000_000;
    __setClockForTest(() => clock);
    for (let i = 0; i < MAX_FAILS; i++) checkAdmin(req("wrong", "8.8.8.8"));
    assert.equal(checkAdmin(req("wrong", "8.8.8.8")).ok, false); // locked
    clock += 16 * 60 * 1000; // advance past the 15-min window
    // Window elapsed → forgiven → a correct secret works again.
    assert.equal(checkAdmin(req("s3cr3t", "8.8.8.8")).ok, true);
  });
});
