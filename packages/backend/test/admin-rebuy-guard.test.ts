/**
 * L8 (admin path) — /admin/rebuy-position must respect the "at most one open
 * position per contract" invariant.
 *
 * runBursar guards the automated buy path, but adminRebuyPosition re-opens a
 * position OUTSIDE runBursar. Without a guard there, an operator could re-open a
 * closed position whose contract is already held open by another position →
 * double exposure (the exact thing L8 prevents on the automated path), or
 * re-buy an already-open position (double-spend + wipe its tracking state).
 *
 * Drives the real `handle` router with an authenticated request + JSON body.
 * The "conflict" test goes RED if the guard is removed (verified in dev).
 */

import "./helpers/isolate-store.js"; // temp DATA_DIR + mock mode before config loads
import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Position } from "@thesis/shared";
import { config } from "../src/config.js";
import { getStore } from "../src/store/index.js";
import { handle } from "../src/server/index.js";
import { __resetAuthStateForTest } from "../src/server/admin-auth.js";

const SECRET = "test-admin-secret";

/** An authenticated POST to an admin route, with a readable JSON body (readBody
 *  consumes req as a stream of Buffers). */
function adminReq(path: string, bodyObj: unknown): IncomingMessage {
  const req = Readable.from([Buffer.from(JSON.stringify(bodyObj))]) as unknown as IncomingMessage;
  Object.assign(req, {
    url: path,
    method: "POST",
    headers: { "x-admin-secret": SECRET },
    socket: { remoteAddress: "127.0.0.1" },
  });
  return req;
}

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

function position(opts: { id: string; contract: string; status: "open" | "closed" }): Position {
  return {
    id: opts.id,
    postId: `${opts.id}-post`,
    authorXId: `${opts.id}-author`,
    authorHandle: "@author",
    postUrl: `https://x.com/author/status/${opts.id}`,
    order: {
      contractAddress: opts.contract,
      chain: "base",
      amountInEth: 0.1,
      takeProfits: [{ priceX: 2, sellFraction: 1 }],
      stopLossX: 0.7,
    },
    status: opts.status,
    entryPriceEth: 1e-6,
    entryTxHash: "0xentry",
    remainingFraction: opts.status === "open" ? 1 : 0,
    tiersHit: 0,
    realisedPnlEth: 0,
    openedAt: new Date().toISOString(),
    ...(opts.status === "closed" ? { closedAt: new Date().toISOString() } : {}),
  };
}

function withAdmin(fn: () => Promise<void>): Promise<void> {
  const s = config.server as { adminSecret: string; adminAllowedIps: string[] };
  const prevSecret = s.adminSecret;
  const prevAllow = s.adminAllowedIps;
  s.adminSecret = SECRET;
  s.adminAllowedIps = [];
  __resetAuthStateForTest();
  return fn().finally(() => {
    s.adminSecret = prevSecret;
    s.adminAllowedIps = prevAllow;
    __resetAuthStateForTest();
  });
}

test("admin rebuy is REJECTED when another open position already holds the contract", async () => {
  await withAdmin(async () => {
    const store = getStore();
    const contract = "0xC0FFEE0000000000000000000000000000000001";
    await store.savePosition(position({ id: "rebuy-open-Y", contract, status: "open" }));
    await store.savePosition(position({ id: "rebuy-closed-Z", contract, status: "closed" }));

    const { res, result } = captureRes();
    await handle(adminReq("/admin/rebuy-position", { positionId: "rebuy-closed-Z" }), res);

    const { status, body } = result();
    assert.equal(status, 409, "must refuse to re-open into a contract already held open");
    assert.match(body.error ?? "", /already holds/i);

    const z = (await store.getAllPositions()).find((p) => p.id === "rebuy-closed-Z");
    assert.equal(z?.status, "closed", "the target position must stay closed when rejected");
  });
});

test("admin rebuy SUCCEEDS when no open position holds the contract", async () => {
  await withAdmin(async () => {
    const store = getStore();
    const contract = "0xC0FFEE0000000000000000000000000000000002"; // unique, nothing open
    await store.savePosition(position({ id: "rebuy-closed-W", contract, status: "closed" }));

    const { res, result } = captureRes();
    await handle(adminReq("/admin/rebuy-position", { positionId: "rebuy-closed-W" }), res);

    assert.equal(result().status, 200, "a clean rebuy must still be allowed");
    const w = (await store.getAllPositions()).find((p) => p.id === "rebuy-closed-W");
    assert.equal(w?.status, "open", "the position is re-opened");
  });
});
