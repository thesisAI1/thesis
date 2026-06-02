/**
 * Type-level regression guard for the OpsEvent union (S2).
 *
 * tsx strips types at runtime, so the runtime body here is trivial — the REAL
 * guard is `npm run typecheck`: if any variant's fields drift from the spec
 * (a field renamed/dropped), this file stops compiling. This exists because
 * the Wave-1 unit tests only exercised `trade:buy` + `error`, letting the other
 * variants drift; the notifier (Wave 2) and money-path wiring (Wave 3) depend
 * on these exact fields.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { OpsEvent } from "../src/observability/opsBus.js";

const samples: OpsEvent[] = [
  { type: "trade:buy", at: "", positionId: "p", handle: "@a", amountEth: 0, contract: "0x", chain: "base" as const },
  { type: "trade:sell", at: "", positionId: "p", tier: 1, proceedsEth: 0, profitEth: 0, chain: "base" as const },
  { type: "position:close", at: "", positionId: "p", netPnlEth: 0, reason: "tp" as const, chain: "base" as const },
  { type: "payout:sent", at: "", path: "direct", chain: "base", handle: "@a", amountEth: 0, wallet: "0x", txHash: "0x" },
  { type: "payout:failed", at: "", chain: "base" as const, handle: "@a", amountEth: 0, reason: "x" },
  { type: "settle:done", at: "", chain: "base" as const, positionId: "p", toAuthorEth: 0, totalProfitEth: 0 },
  { type: "settle:summary", at: "", positionId: "p", handle: "@a", totalProfitEth: 0, toAuthorEth: 0, toPortfolioEth: 0, toBuybackEth: 0, authorPaid: "direct" },
  { type: "settle:failed", at: "", positionId: "p", reason: "x" },
  { type: "tweet:posted", at: "", kind: "buy", replyId: "1", postId: "2" },
  { type: "error", at: "", area: "svc", msg: "m" },
  { type: "liveness:stale", at: "", secondsSinceTick: 0 },
];

describe("OpsEvent union shapes (type-level guard)", () => {
  it("constructs one of every variant with its spec fields", () => {
    assert.equal(samples.length, 11);
  });
});
