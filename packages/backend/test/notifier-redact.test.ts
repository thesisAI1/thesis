/**
 * RED tests — security gaps in formatOpsEvent + startNotifier.
 * Do NOT modify src to make these pass yet.
 *
 * Gap 1: error / payout:failed branches return raw msg/reason — no redaction.
 * Gap 2: startNotifier ignores an injected `enabled:false` flag (not yet a seam).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatOpsEvent, startNotifier } from "../src/adapters/telegram/notifier.js";
import { publishOps } from "../src/observability/opsBus.js";
import { MockTelegram } from "../src/adapters/telegram/mock.js";

// ---------------------------------------------------------------------------
// 1. formatOpsEvent — error branch must redact full 40-hex wallet address
// ---------------------------------------------------------------------------

describe("formatOpsEvent — error branch redacts wallet addresses (RED)", () => {
  it("does NOT leak a full 0x+40-hex address embedded in msg", () => {
    const fullAddr = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const out = formatOpsEvent({
      type: "error",
      at: "t",
      area: "payout",
      msg: `sendEth to ${fullAddr} reverted`,
    });
    assert.ok(typeof out === "string", "should return a string for error events");
    // RED: current impl returns raw msg — full address will be present → assertion fails
    assert.ok(
      !out!.includes(fullAddr),
      `SECURITY: full 40-hex address must be redacted from error msg. Got: ${out}`,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. formatOpsEvent — payout:failed branch must redact full 64-hex tx hash
// ---------------------------------------------------------------------------

describe("formatOpsEvent — payout:failed branch redacts tx hashes (RED)", () => {
  it("does NOT leak a full 0x+64-hex tx hash embedded in reason", () => {
    const fullTx =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const out = formatOpsEvent({
      type: "payout:failed",
      at: "t",
      handle: "@a",
      amountEth: 0.5,
      reason: `reverted tx ${fullTx}`,
    });
    assert.ok(out !== null, "should return a non-null string for payout:failed");
    // RED: current impl interpolates raw reason — full tx hash will be present → fails
    assert.ok(
      !out!.includes(fullTx),
      `SECURITY: full 64-hex tx hash must be redacted from payout:failed reason. Got: ${out}`,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. startNotifier — respects injected enabled:false (seam does not exist yet)
// ---------------------------------------------------------------------------

describe("startNotifier — enabled:false gate (RED)", () => {
  it("sends nothing when enabled is false", async () => {
    const mock = new MockTelegram();
    // RED: startNotifier currently has no `enabled` param; the cast forces compilation
    // while the runtime behaviour will still send → mock.sent.length will be 1, not 0.
    const stop = (startNotifier as (deps?: {
      adapter?: InstanceType<typeof MockTelegram>;
      allowedChats?: string[];
      enabled?: boolean;
    }) => () => void)({ adapter: mock, allowedChats: ["111"], enabled: false });

    publishOps({ type: "error", at: "t", area: "svc", msg: "x" });

    // Give async sends a tick
    await new Promise((r) => setImmediate(r));

    stop();

    // RED: without the enabled gate this will be 1, not 0
    assert.equal(mock.sent.length, 0, "enabled:false must suppress all sends");
  });
});
