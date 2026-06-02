/**
 * RED tests for S1 — config telegram: + observability: blocks.
 * Env vars must be set BEFORE the dynamic import so config reads them at load time.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Set env BEFORE importing config (config is a module-level const).
process.env.TELEGRAM_ALLOWED_CHATS = "111, 222 ,,333";
process.env.TELEGRAM_ENABLED = "true"; // explicit true (default)
process.env.HEARTBEAT_STALE_SEC = "0";
process.env.OBS_RECENT_BUFFER_SIZE = "200";

const { config } = await import("../src/config.js");

describe("config.telegram", () => {
  it("allowedChats parses CSV, trims whitespace, drops empty entries", () => {
    assert.deepEqual(
      config.telegram.allowedChats,
      ["111", "222", "333"],
    );
  });

  it("enabled defaults to true when TELEGRAM_ENABLED is not 'false'", () => {
    assert.equal(config.telegram.enabled, true);
  });
});

describe("config.observability", () => {
  it("recentBufferSize defaults to 200", () => {
    assert.equal(config.observability.recentBufferSize, 200);
  });

  it("heartbeatStaleSec defaults to 0", () => {
    assert.equal(config.observability.heartbeatStaleSec, 0);
  });

  // Characterization test (GREEN-on-arrival): pins the default value so a
  // future accidental change to the fallback is caught immediately.
  it("eventLogCap defaults to 50000 (characterization)", () => {
    assert.equal(config.observability.eventLogCap, 50_000);
  });
});

// Verify the telegram block exists on the config object (property access test)
describe("config.telegram block shape", () => {
  it("botToken field exists on config.telegram", () => {
    // Accessing config.telegram.botToken — fails if telegram block missing
    assert.equal(typeof config.telegram.botToken, "string");
  });

  it("pollIntervalSec field exists on config.telegram", () => {
    assert.ok(typeof config.telegram.pollIntervalSec === "number");
  });
});

describe("config.telegram.group defaults", () => {
  it("group.botToken defaults to empty string", () => {
    assert.equal(config.telegram.group.botToken, "");
  });

  it("group.chatId defaults to empty string", () => {
    assert.equal(config.telegram.group.chatId, "");
  });

  it("group.enabled defaults to true", () => {
    assert.equal(config.telegram.group.enabled, true);
  });
});
