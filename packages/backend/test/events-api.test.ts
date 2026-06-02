/**
 * TDD RED — GET /api/events (structured event log read API).
 *
 * The route does NOT exist yet — every test expects HTTP 200 but will receive
 * a static-file 404 (serveStatic falls through for unknown /api/* paths), which
 * is "route absent" not a harness error. That is the expected RED failure mode.
 *
 * Route shape chosen to mirror existing conventions in server/index.ts:
 *   - Path:          /api/events        (flat /api/* namespace like /api/status)
 *   - Response:      { events: EventLogEntry[] }  (named array like dashboard's
 *                    recentActivity / openPositions — not a bare array)
 *   - Query params:  ?area=<string>   filter to one area
 *                    ?level=<string>  filter to one level (info|warn|error)
 *                    ?n=<number>      cap result count (mirrors recent(n) API)
 *   - Order:         newest-first (matches MemoryEventLog.recent() contract)
 *
 * GREEN will add a single dispatch line in handle() + a thin apiEvents() handler
 * that calls getEventLog().recent(n) and applies optional area/level filters.
 */

import "./helpers/isolate-store.js"; // temp DATA_DIR + mock mode before config loads
import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handle } from "../src/server/index.js";
import { getEventLog } from "../src/observability/eventLog.js";
import type { EventLogEntry } from "../src/observability/eventLog.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal GET request stub. query is appended as-is (e.g. "?area=payout"). */
function getReq(path: string): IncomingMessage {
  return {
    url: path,
    method: "GET",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;
}

/** Capture sendJson(res, status, body) output. */
function captureRes(): {
  res: ServerResponse;
  result: () => { status: number; body: unknown };
} {
  let status = 0;
  let body: unknown = null;
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

/** Seed distinct entries into the event log singleton. Returns them newest-first. */
function seedEntries(): EventLogEntry[] {
  const log = getEventLog();

  const entries: EventLogEntry[] = [
    {
      at: new Date(1_000_000).toISOString(),
      level: "info",
      area: "service",
      type: "service:start",
      msg: "service started",
    },
    {
      at: new Date(2_000_000).toISOString(),
      level: "warn",
      area: "monitor",
      type: "price:stale",
      msg: "price is stale",
    },
    {
      at: new Date(3_000_000).toISOString(),
      level: "error",
      area: "payout",
      type: "payout:failed",
      msg: "payout transfer reverted",
    },
    {
      at: new Date(4_000_000).toISOString(),
      level: "info",
      area: "payout",
      type: "payout:sent",
      msg: "payout sent ok",
    },
    {
      at: new Date(5_000_000).toISOString(),
      level: "error",
      area: "service",
      type: "orphaned-buy",
      msg: "orphaned buy detected",
    },
  ];

  for (const e of entries) {
    log.record(e);
  }

  // newest-first order (matches recent())
  return entries.slice().reverse();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("GET /api/events — 200 with events array, newest-first, all required fields present", async () => {
  const seeded = seedEntries();

  const { res, result } = captureRes();
  await handle(getReq("/api/events"), res);

  const { status, body } = result();
  assert.equal(status, 200, `expected 200 but got ${status} — route is absent (RED)`);

  assert.ok(
    body !== null && typeof body === "object",
    "body should be an object",
  );
  const { events } = body as { events: EventLogEntry[] };
  assert.ok(Array.isArray(events), "body.events must be an array");
  assert.ok(events.length >= seeded.length, "should contain at least the seeded entries");

  // Verify all five required fields on each entry
  for (const e of events) {
    assert.ok("at" in e, "entry must have 'at'");
    assert.ok("level" in e, "entry must have 'level'");
    assert.ok("area" in e, "entry must have 'area'");
    assert.ok("type" in e, "entry must have 'type'");
    assert.ok("msg" in e, "entry must have 'msg'");
  }

  // Newest-first: compare the first two timestamps
  if (events.length >= 2) {
    assert.ok(
      events[0].at >= events[1].at,
      `events should be newest-first: [0].at=${events[0].at} < [1].at=${events[1].at}`,
    );
  }

  // Seeded entries must all be present
  const msgs = new Set(events.map((e) => e.msg));
  for (const s of seeded) {
    assert.ok(msgs.has(s.msg), `seeded entry "${s.msg}" missing from response`);
  }
});

test("GET /api/events?area=payout — returns only payout-area entries", async () => {
  seedEntries();

  const { res, result } = captureRes();
  await handle(getReq("/api/events?area=payout"), res);

  const { status, body } = result();
  assert.equal(status, 200, `expected 200 but got ${status} — route is absent (RED)`);

  const { events } = body as { events: EventLogEntry[] };
  assert.ok(Array.isArray(events), "body.events must be an array");
  assert.ok(events.length > 0, "should have at least one payout entry");

  for (const e of events) {
    assert.equal(e.area, "payout", `all entries must have area="payout", got "${e.area}"`);
  }

  // Non-payout entries must be absent
  const serviceEntry = events.find((e) => e.area === "service");
  assert.equal(serviceEntry, undefined, "service-area entries must be filtered out");
});

test("GET /api/events?level=error — returns only error-level entries", async () => {
  seedEntries();

  const { res, result } = captureRes();
  await handle(getReq("/api/events?level=error"), res);

  const { status, body } = result();
  assert.equal(status, 200, `expected 200 but got ${status} — route is absent (RED)`);

  const { events } = body as { events: EventLogEntry[] };
  assert.ok(Array.isArray(events), "body.events must be an array");
  assert.ok(events.length > 0, "should have at least one error entry");

  for (const e of events) {
    assert.equal(e.level, "error", `all entries must have level="error", got "${e.level}"`);
  }

  // Non-error entries must be absent
  const infoEntry = events.find((e) => e.level !== "error");
  assert.equal(infoEntry, undefined, "non-error entries must be filtered out");
});

test("GET /api/events?n=2 — returns at most 2 entries", async () => {
  seedEntries();

  const { res, result } = captureRes();
  await handle(getReq("/api/events?n=2"), res);

  const { status, body } = result();
  assert.equal(status, 200, `expected 200 but got ${status} — route is absent (RED)`);

  const { events } = body as { events: EventLogEntry[] };
  assert.ok(Array.isArray(events), "body.events must be an array");
  assert.ok(events.length <= 2, `expected ≤2 entries with ?n=2, got ${events.length}`);
});

test("GET /api/events — wallet address in msg is redacted (security guard)", async () => {
  const fullAddr = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
  getEventLog().record({
    at: new Date(6_000_000).toISOString(),
    level: "error",
    area: "payout",
    type: "payout:failed",
    msg: `lottery send failed: ${fullAddr}`,
  });

  const { res, result } = captureRes();
  await handle(getReq("/api/events"), res);

  const { status, body } = result();
  assert.equal(status, 200, "expected 200");

  const responseText = JSON.stringify(body);
  assert.ok(
    !responseText.includes(fullAddr),
    `full 40-hex address must not appear in response — redaction failed`,
  );
});
