/**
 * RED tests for S9 — Telegram notifier: formatOpsEvent (pure) + startNotifier (integration).
 * Modules do not exist yet → RED.
 *
 * DI contract:
 *   formatOpsEvent(e: OpsEvent): string | null   — pure, exported
 *   startNotifier(deps?: { adapter?: TelegramAdapter; allowedChats?: string[] }): () => void
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatOpsEvent, startNotifier } from "../src/adapters/telegram/notifier.js";
import { publishOps } from "../src/observability/opsBus.js";
import { MockTelegram } from "../src/adapters/telegram/mock.js";

// ---------------------------------------------------------------------------
// formatOpsEvent — pure function tests
// ---------------------------------------------------------------------------

describe("formatOpsEvent — error", () => {
  it("formats error event with 🔴 prefix and message body", () => {
    const out = formatOpsEvent({ type: "error", at: new Date().toISOString(), area: "svc", msg: "boom" });
    assert.ok(out !== null, "should return a string for error events");
    assert.ok(out!.startsWith("🔴"), `expected 🔴 prefix, got: ${out}`);
    assert.ok(out!.includes("boom"), "should contain the error message");
  });
});

describe("formatOpsEvent — tweet:posted", () => {
  it("formats tweet:posted event with 🐦 prefix", () => {
    const out = formatOpsEvent({
      type: "tweet:posted",
      at: new Date().toISOString(),
      kind: "buy",
      replyId: "tweet123",
      postId: "post456",
    });
    assert.ok(out !== null, "should return a string for tweet:posted");
    assert.ok(out!.startsWith("🐦"), `expected 🐦 prefix, got: ${out}`);
  });
});

describe("formatOpsEvent — liveness:stale", () => {
  it("formats liveness:stale event with ⚠️ prefix", () => {
    const out = formatOpsEvent({
      type: "liveness:stale",
      at: new Date().toISOString(),
      secondsSinceTick: 120,
    });
    assert.ok(out !== null, "should return a string for liveness:stale");
    assert.ok(out!.startsWith("⚠️"), `expected ⚠️ prefix, got: ${out}`);
  });
});

describe("formatOpsEvent — address redaction (AC8)", () => {
  it("truncates wallet and txHash — never emits full 0x addresses", () => {
    const fullWallet = "0x1234567890abcdef1234567890abcdef12345678";
    const fullTx = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

    const out = formatOpsEvent({
      type: "payout:sent",
      at: new Date().toISOString(),
      handle: "@alice",
      amountEth: 0.5,
      wallet: fullWallet,
      txHash: fullTx,
    });

    assert.ok(out !== null, "should return a string for payout:sent");
    assert.ok(!out!.includes(fullWallet), `SECURITY: full wallet address must not appear in message. Got: ${out}`);
    assert.ok(!out!.includes(fullTx), `SECURITY: full txHash must not appear in message. Got: ${out}`);
    // Truncated form should be present (e.g. "0x1234…5678")
    assert.ok(
      out!.includes("0x1234") && out!.includes("5678"),
      `truncated wallet should appear, got: ${out}`,
    );
  });
});

// ---------------------------------------------------------------------------
// startNotifier — integration tests (uses DI adapter + allowedChats)
// ---------------------------------------------------------------------------

describe("startNotifier — integration", () => {
  it("delivers error ops event to every allowlisted chat", async () => {
    const mock = new MockTelegram();
    const stop = startNotifier({ adapter: mock, allowedChats: ["111", "222"] });

    publishOps({ type: "error", at: new Date().toISOString(), area: "svc", msg: "x" });

    // Give the async sends a tick to resolve
    await new Promise((r) => setImmediate(r));

    stop();

    assert.equal(mock.sent.length, 2, "should send to both chats");
    assert.ok(mock.sent[0]!.text.startsWith("🔴"), "first message should start with 🔴");
    assert.ok(mock.sent[1]!.text.startsWith("🔴"), "second message should start with 🔴");
  });

  it("after stop(), publishing further events sends nothing more", async () => {
    const mock = new MockTelegram();
    const stop = startNotifier({ adapter: mock, allowedChats: ["111", "222"] });

    publishOps({ type: "error", at: new Date().toISOString(), area: "svc", msg: "first" });
    await new Promise((r) => setImmediate(r));

    stop();
    const countAfterStop = mock.sent.length;

    publishOps({ type: "error", at: new Date().toISOString(), area: "svc", msg: "second" });
    await new Promise((r) => setImmediate(r));

    assert.equal(mock.sent.length, countAfterStop, "stop() must unsubscribe — no further sends");
  });

  it("empty allowedChats disables the notifier entirely", async () => {
    const mock = new MockTelegram();
    startNotifier({ adapter: mock, allowedChats: [] });

    publishOps({ type: "error", at: new Date().toISOString(), area: "svc", msg: "ignored" });
    await new Promise((r) => setImmediate(r));

    assert.equal(mock.sent.length, 0, "no chats → nothing sent");
  });
});
