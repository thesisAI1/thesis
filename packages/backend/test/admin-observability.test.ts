/**
 * TDD RED — Admin handler observability gaps (G5, G7, G8, G10, G11).
 *
 * Each test subscribes to the ops bus (subscribeOps) or the event log
 * (getEventLog) before invoking the admin handler via the real `handle`
 * router (same approach as admin-rebuy-guard.test.ts), then asserts the
 * expected ops event / log entry is present. All tests are currently RED
 * because the handlers emit no ops today.
 *
 * G5  adminSettleStuckPayout  sendEth revert  → payout:failed ops
 *                             sendEth success → payout:sent ops
 * G7  adminForceClosePosition closeByAuthor throws → error ops
 * G8  adminRebuyPosition      buy reverts          → error ops
 * G10 adminRepostCloseAnnouncement replyToPost fails → error ops
 *     (SKIPPED: MockX.replyToPost never throws; no __setXAdapterForTest override)
 * G11 dashboard batch price-fetch fallback → logEvent warn in getEventLog()
 *     (SKIPPED: MockBaseData.getPricesEth never throws; no __setBaseDataForTest override)
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
import {
  __setChainForTest,
  type ChainAdapter,
} from "../src/adapters/chain/index.js";
import { subscribeOps, type OpsEvent } from "../src/observability/opsBus.js";
import { getEventLog } from "../src/observability/eventLog.js";

// ── Shared test infrastructure ───────────────────────────────────────────────

const SECRET = "test-admin-secret";

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
  result: () => { status: number; body: Record<string, unknown> };
} {
  let status = 0;
  let body: Record<string, unknown> = {};
  const res = {
    headersSent: false,
    writeHead(s: number) {
      status = s;
      (this as { headersSent: boolean }).headersSent = true;
      return this;
    },
    end(chunk?: string) {
      if (chunk) body = JSON.parse(chunk) as Record<string, unknown>;
      return this;
    },
  } as unknown as ServerResponse;
  return { res, result: () => ({ status, body }) };
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
    __setChainForTest(null);
  });
}

/** Collect ops events emitted during `fn()`. Returns unsubscribe + collected array. */
function collectOps(): { events: OpsEvent[]; unsubscribe: () => void } {
  const events: OpsEvent[] = [];
  const unsubscribe = subscribeOps((e) => events.push(e));
  return { events, unsubscribe };
}

function makePosition(opts: {
  id: string;
  contract: string;
  status: "open" | "closed";
  authorXId?: string;
}): Position {
  return {
    id: opts.id,
    postId: `${opts.id}-post`,
    authorXId: opts.authorXId ?? `${opts.id}-author`,
    authorHandle: "@testauthor",
    postUrl: `https://x.com/testauthor/status/${opts.id}`,
    order: {
      contractAddress: opts.contract,
      chain: "base",
      amountInEth: 0.05,
      takeProfits: [{ priceX: 2, sellFraction: 1 }],
      stopLossX: 0.7,
    },
    status: opts.status,
    entryPriceEth: 1e-6,
    entryTxHash: "0xentrytx",
    remainingFraction: opts.status === "open" ? 1 : 0,
    tiersHit: 0,
    realisedPnlEth: 0,
    openedAt: new Date().toISOString(),
    ...(opts.status === "closed" ? { closedAt: new Date().toISOString() } : {}),
  };
}

/** A ChainAdapter stub where every method resolves fine except the one override. */
function stubChain(overrides: Partial<ChainAdapter>): ChainAdapter {
  return {
    getWalletAddress: () => "0xstub",
    getWalletBalanceEth: async () => 1.0,
    async buy() {
      return { txHash: "0xstub-buy", amountOut: 1000, priceEth: 1e-6 };
    },
    async sell() {
      return { txHash: "0xstub-sell", amountOut: 0.05, priceEth: 1e-6 };
    },
    async getTokenPriceEth() {
      return 1e-6;
    },
    async quoteSell() {
      return { proceedsEth: 0.05 };
    },
    async sendEth() {
      return "0xstub-send";
    },
    async buybackAndBurn() {
      return { txHash: "0xstub-burn", tokensBurned: 1000 };
    },
    ...overrides,
  };
}

// ── G5 — adminSettleStuckPayout ──────────────────────────────────────────────

test("G5: adminSettleStuckPayout sendEth revert → payout:failed ops emitted", async () => {
  await withAdmin(async () => {
    __setChainForTest(
      stubChain({
        sendEth: async () => {
          throw new Error("on-chain revert: execution reverted");
        },
      }),
    );

    const { events, unsubscribe } = collectOps();
    try {
      const { res } = captureRes();
      await handle(
        adminReq("/admin/settle-stuck-payout", {
          xUserId: "g5-user-fail",
          wallet: "0xDeAdBeEf0000000000000000000000000000000A",
          handle: "@g5author",
          amountEth: 0.01,
        }),
        res,
      );
    } finally {
      unsubscribe();
    }

    const payoutFailed = events.find((e) => e.type === "payout:failed");
    assert.ok(
      payoutFailed,
      `expected a payout:failed ops event; got: [${events.map((e) => e.type).join(", ")}]`,
    );
    assert.equal(payoutFailed.type, "payout:failed");
  });
});

test("G5: adminSettleStuckPayout sendEth success → payout:sent ops emitted", async () => {
  await withAdmin(async () => {
    __setChainForTest(
      stubChain({
        sendEth: async () => "0xsuccesstxhash",
      }),
    );

    const { events, unsubscribe } = collectOps();
    try {
      const { res } = captureRes();
      await handle(
        adminReq("/admin/settle-stuck-payout", {
          xUserId: "g5-user-ok",
          wallet: "0xDeAdBeEf0000000000000000000000000000000B",
          handle: "@g5authorsuccess",
          amountEth: 0.01,
        }),
        res,
      );
    } finally {
      unsubscribe();
    }

    const payoutSent = events.find((e) => e.type === "payout:sent");
    assert.ok(
      payoutSent,
      `expected a payout:sent ops event; got: [${events.map((e) => e.type).join(", ")}]`,
    );
    assert.equal(payoutSent.type, "payout:sent");
  });
});

// ── G7 — adminForceClosePosition ────────────────────────────────────────────

test("G7: adminForceClosePosition closeByAuthor throws → error ops emitted", async () => {
  await withAdmin(async () => {
    const store = getStore();
    const contract = "0xF0RCECL0SE0000000000000000000000000000G7";
    await store.savePosition(
      makePosition({ id: "force-close-g7", contract, status: "open" }),
    );

    // Make the chain's sell() throw so closeByAuthor exhausts and throws.
    __setChainForTest(
      stubChain({
        sell: async () => {
          throw new Error("TRANSFER_FROM_FAILED: anti-MEV hook blocked sell");
        },
      }),
    );

    const { events, unsubscribe } = collectOps();
    try {
      const { res } = captureRes();
      await handle(
        adminReq("/admin/force-close-position", { positionId: "force-close-g7" }),
        res,
      );
    } finally {
      unsubscribe();
    }

    const errorEvent = events.find((e) => e.type === "error");
    assert.ok(
      errorEvent,
      `expected an error ops event for force-close failure; got: [${events.map((e) => e.type).join(", ")}]`,
    );
    assert.equal(errorEvent.type, "error");
  });
});

// ── G8 — adminRebuyPosition ──────────────────────────────────────────────────

test("G8: adminRebuyPosition buy reverts → error ops emitted", async () => {
  await withAdmin(async () => {
    const store = getStore();
    const contract = "0xREB00000000000000000000000000000000000G8";
    await store.savePosition(
      makePosition({ id: "rebuy-g8", contract, status: "closed" }),
    );

    __setChainForTest(
      stubChain({
        buy: async () => {
          throw new Error("on-chain revert: insufficient output amount");
        },
      }),
    );

    const { events, unsubscribe } = collectOps();
    try {
      const { res } = captureRes();
      await handle(
        adminReq("/admin/rebuy-position", { positionId: "rebuy-g8" }),
        res,
      );
    } finally {
      unsubscribe();
    }

    const errorEvent = events.find((e) => e.type === "error");
    assert.ok(
      errorEvent,
      `expected an error ops event for rebuy failure; got: [${events.map((e) => e.type).join(", ")}]`,
    );
    assert.equal(errorEvent.type, "error");
  });
});

// ── G10 — adminRepostCloseAnnouncement ──────────────────────────────────────

test.skip(
  "G10: adminRepostCloseAnnouncement replyToPost fails → error ops emitted (honest gap: MockX.replyToPost never throws; no __setXAdapterForTest override exists — would require adding a test-override hook to adapters/x/index.ts)",
);

// ── G11 — dashboard batch price-fetch fallback ───────────────────────────────

test.skip(
  "G11: GET /api/dashboard with price fetch throwing → logEvent warn in getEventLog() (honest gap: MockBaseData.getPricesEth never throws; no __setBaseDataForTest override exists — would require adding a test-override hook to adapters/basedata/index.ts)",
);
