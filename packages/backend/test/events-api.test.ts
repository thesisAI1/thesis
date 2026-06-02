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
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handle } from "../src/server/index.js";
import { getEventLog, resetEventLogForTest } from "../src/observability/eventLog.js";
import type { EventLogEntry } from "../src/observability/eventLog.js";

// Reset singleton before each test so entries don't leak across tests.
beforeEach(() => {
  resetEventLogForTest();
});

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

// ── PR-review RED: cache-control header ──────────────────────────────────────

/** Capture headers set via writeHead(status, headers). */
function captureResWithHeaders(): {
  res: ServerResponse;
  result: () => { status: number; body: unknown; headers: Record<string, string> };
} {
  let status = 0;
  let body: unknown = null;
  const headers: Record<string, string> = {};
  const res = {
    headersSent: false,
    writeHead(s: number, hdrs?: Record<string, string>) {
      status = s;
      (this as { headersSent: boolean }).headersSent = true;
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) {
          headers[k.toLowerCase()] = String(v);
        }
      }
      return this;
    },
    end(chunk?: string) {
      if (chunk) body = JSON.parse(chunk);
      return this;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = String(value);
    },
  } as unknown as ServerResponse;
  return { res, result: () => ({ status, body, headers }) };
}

test("GET /api/events — response includes cache-control: no-store (RED)", async () => {
  const { res, result } = captureResWithHeaders();
  await handle(getReq("/api/events"), res);

  const { status, headers } = result();
  assert.equal(status, 200, "expected 200");

  // RED: sendJson only sets content-type; cache-control header is absent.
  const cc = headers["cache-control"] ?? "";
  assert.ok(
    cc.includes("no-store") || cc.includes("no-cache"),
    `cache-control must include 'no-store' or 'no-cache' to prevent sensitive event data from being cached. Got: "${cc}"`,
  );
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

// ── Wave 4: ?history=1 durable branch (RED) ───────────────────────────────────

const SENTINEL: EventLogEntry = {
  at: new Date(9_999_999).toISOString(),
  level: "info",
  area: "test",
  type: "test:sentinel",
  msg: "sentinel from history()",
};

const SENTINEL_ADDR = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const SENTINEL_WITH_ADDR: EventLogEntry = {
  at: new Date(9_999_998).toISOString(),
  level: "error",
  area: "payout",
  type: "payout:failed",
  msg: `payout failed addr=${SENTINEL_ADDR}`,
};

test("GET /api/events?history=1 — response built from history(), not recent() (RED)", async () => {
  const log = getEventLog();
  const originalHistory = log.history.bind(log);

  // Monkeypatch: history() returns the sentinel regardless of what's in recent()
  log.history = async (_opts) => [SENTINEL];

  try {
    const { res, result } = captureResWithHeaders();
    await handle(getReq("/api/events?history=1"), res);

    const { status, body, headers } = result();
    assert.equal(status, 200, "expected 200");

    const { events } = body as { events: EventLogEntry[] };
    assert.ok(Array.isArray(events), "body.events must be an array");

    // Sentinel must appear — proves history() was called, not recent()
    const found = events.find((e) => e.type === SENTINEL.type);
    assert.ok(
      found !== undefined,
      `sentinel entry (type=${SENTINEL.type}) not found — handler did not call history() (RED)`,
    );

    // Same JSON shape as default path
    assert.ok("at" in found!, "entry must have 'at'");
    assert.ok("level" in found!, "entry must have 'level'");
    assert.ok("area" in found!, "entry must have 'area'");
    assert.ok("type" in found!, "entry must have 'type'");
    assert.ok("msg" in found!, "entry must have 'msg'");

    // Same headers as default path: cache-control must include no-store
    const cc = headers["cache-control"] ?? "";
    assert.ok(
      cc.includes("no-store") || cc.includes("no-cache"),
      `cache-control must include 'no-store' on ?history=1 path. Got: "${cc}"`,
    );
  } finally {
    log.history = originalHistory;
  }
});

test("GET /api/events (default, no ?history) — still uses recent(), NOT history() (RED)", async () => {
  const log = getEventLog();
  const originalHistory = log.history.bind(log);

  let historyCalled = false;
  log.history = async (opts) => {
    historyCalled = true;
    return originalHistory(opts);
  };

  try {
    // Seed a known entry so recent() has something
    log.record({
      at: new Date(8_000_000).toISOString(),
      level: "info",
      area: "service",
      type: "service:ping",
      msg: "ping",
    });

    const { res, result } = captureRes();
    await handle(getReq("/api/events"), res);

    const { status, body } = result();
    assert.equal(status, 200, "expected 200 on default path");
    assert.ok(
      (body as { events: unknown[] }).events !== undefined,
      "body.events must exist",
    );
    assert.ok(
      !historyCalled,
      "default path must NOT call history() — it must use recent() only",
    );
  } finally {
    log.history = originalHistory;
  }
});

test("GET /api/events?history=1 — wallet address in msg is redacted (security guard)", async () => {
  const log = getEventLog();
  const originalHistory = log.history.bind(log);

  log.history = async (_opts) => [SENTINEL_WITH_ADDR];

  try {
    const { res, result } = captureRes();
    await handle(getReq("/api/events?history=1"), res);

    const { status, body } = result();
    assert.equal(status, 200, "expected 200");

    const responseText = JSON.stringify(body);
    assert.ok(
      !responseText.includes(SENTINEL_ADDR),
      `full address must not appear in ?history=1 response — redaction must apply to history path too`,
    );
  } finally {
    log.history = originalHistory;
  }
});

test("GET /api/events?history=1&opsType=trade:buy,settle:win — opsTypes forwarded to history() (RED)", async () => {
  const log = getEventLog();
  const originalHistory = log.history.bind(log);

  let capturedOpts: { limit: number; opsTypes?: string[] } | undefined;
  log.history = async (opts) => {
    capturedOpts = opts;
    return [SENTINEL];
  };

  try {
    const { res } = captureRes();
    await handle(getReq("/api/events?history=1&opsType=trade:buy,settle:win"), res);

    assert.ok(capturedOpts !== undefined, "history() must have been called");
    assert.deepEqual(
      capturedOpts!.opsTypes,
      ["trade:buy", "settle:win"],
      `opsTypes must be parsed from ?opsType= param and forwarded. Got: ${JSON.stringify(capturedOpts!.opsTypes)}`,
    );
  } finally {
    log.history = originalHistory;
  }
});

test("GET /api/events?history=1 — history() REJECTS → endpoint returns 500, no crash", async () => {
  const log = getEventLog();
  const originalHistory = log.history.bind(log);

  log.history = async (_opts) => { throw new Error("db gone"); };

  try {
    const { res, result } = captureRes();
    // The 500 comes from startServer()'s top-level handle().catch wrapper, NOT from
    // apiEvents itself: apiEvents writes nothing before its `await history()`, so a
    // rejection propagates cleanly to that wrapper. handle() is tested in isolation here,
    // so we mirror the wrapper. COUPLING: if startServer's catch wrapper is ever removed,
    // prod would hang on a history() reject while THIS test stays green — keep them in sync.
    await handle(getReq("/api/events?history=1"), res).catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(err) }));
      }
    });

    const { status } = result();
    assert.equal(status, 500, `expected 500 when history() rejects, got ${status}`);
  } finally {
    log.history = originalHistory;
  }
});

test("GET /api/events?history=1&opsType= (empty) — opsTypes forwarded as undefined, NOT [\"\"]", async () => {
  const log = getEventLog();
  const originalHistory = log.history.bind(log);

  let capturedOpts: { limit: number; opsTypes?: string[] } | undefined;
  log.history = async (opts) => {
    capturedOpts = opts;
    return [];
  };

  try {
    const { res } = captureRes();
    await handle(getReq("/api/events?history=1&opsType="), res);

    assert.ok(capturedOpts !== undefined, "history() must have been called");
    assert.equal(
      capturedOpts!.opsTypes,
      undefined,
      `empty ?opsType= must produce opsTypes===undefined, got: ${JSON.stringify(capturedOpts!.opsTypes)}`,
    );
  } finally {
    log.history = originalHistory;
  }
});

test("GET /api/events?history=1&area=monitor&level=error — area+level forwarded to history() opts", async () => {
  const log = getEventLog();
  const originalHistory = log.history.bind(log);

  let capturedOpts: { limit: number; opsTypes?: string[]; area?: string; level?: string } | undefined;
  log.history = async (opts) => {
    capturedOpts = opts;
    return [SENTINEL];
  };

  try {
    const { res } = captureRes();
    await handle(getReq("/api/events?history=1&area=monitor&level=error"), res);

    assert.ok(capturedOpts !== undefined, "history() must have been called");
    assert.equal(
      capturedOpts!.area,
      "monitor",
      `area must be forwarded to history(). Got: ${JSON.stringify(capturedOpts!.area)}`,
    );
    assert.equal(
      capturedOpts!.level,
      "error",
      `level must be forwarded to history(). Got: ${JSON.stringify(capturedOpts!.level)}`,
    );
  } finally {
    log.history = originalHistory;
  }
});
