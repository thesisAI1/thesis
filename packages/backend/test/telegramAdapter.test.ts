/**
 * RED tests for S5+S6 — Telegram adapter factory + MockTelegram.
 * Modules do not exist yet — import will throw at runtime → RED.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createTelegramAdapter } from "../src/adapters/telegram/index.js";
import { MockTelegram } from "../src/adapters/telegram/mock.js";

describe("createTelegramAdapter()", () => {
  it("returns a MockTelegram instance (config.mode defaults to mock)", () => {
    const adapter = createTelegramAdapter();
    assert.ok(
      adapter instanceof MockTelegram,
      "createTelegramAdapter() must return MockTelegram in mock mode — zero real api.telegram.org calls",
    );
  });
});

describe("MockTelegram", () => {
  it("sendMessage returns true and records the message in a per-instance sent array", async () => {
    const m = new MockTelegram();
    const result = await m.sendMessage("1", "hi");

    assert.equal(result, true, "sendMessage should return true");
    assert.equal(m.sent.length, 1, "sent array should contain one entry");
    assert.deepEqual(m.sent[0], { chatId: "1", text: "hi" });
  });

  it("per-instance sent arrays are isolated (no cross-instance contamination)", async () => {
    const m1 = new MockTelegram();
    const m2 = new MockTelegram();

    await m1.sendMessage("111", "msg-a");

    assert.equal(m1.sent.length, 1, "m1 should have one sent message");
    assert.equal(m2.sent.length, 0, "m2 should not share m1's sent array");
  });

  it("getUpdates returns an empty array", async () => {
    const m = new MockTelegram();
    const updates = await m.getUpdates();
    assert.deepEqual(updates, [], "getUpdates must return [] — MockTelegram never produces updates");
  });

  it("getUpdates with an offset still returns []", async () => {
    const m = new MockTelegram();
    const updates = await m.getUpdates(42);
    assert.deepEqual(updates, []);
  });
});
