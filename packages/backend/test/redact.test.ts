/**
 * RED tests for redact util — imports from a module that does NOT exist yet.
 * All tests in this file will fail with ERR_MODULE_NOT_FOUND until
 * src/adapters/telegram/redact.ts is created.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { redactText, truncAddr } from "../src/adapters/telegram/redact.js";

describe("truncAddr", () => {
  it("truncates a full 42-char ETH address to a shorter prefix…suffix form", () => {
    const full = "0x1234567890abcdef1234567890abcdef12345678";
    const out = truncAddr(full);
    assert.notEqual(out, full, "should not equal the original address");
    assert.ok(out.length < full.length, "truncated form must be shorter than input");
    assert.ok(out.startsWith("0x1234"), `should start with '0x1234', got: ${out}`);
    assert.ok(out.endsWith("5678"), `should end with '5678', got: ${out}`);
  });

  it("passes through short strings (<=12 chars) unchanged", () => {
    const short = "0x123";
    const out = truncAddr(short);
    assert.equal(out, short, "strings of 12 chars or fewer must be returned as-is");
  });
});

describe("redactText", () => {
  it("scrubs a Telegram bot token from a URL string", () => {
    const input =
      "https://api.telegram.org/bot8123456789:AAFakeTokenPart_lol-123/getUpdates failed";
    const out = redactText(input);
    assert.ok(
      !out.includes("8123456789:AAFakeTokenPart_lol-123"),
      `bot token must be redacted; got: ${out}`,
    );
  });

  it("scrubs a full ETH address but preserves surrounding text", () => {
    const addr = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const input = `paid ${addr} to user`;
    const out = redactText(input);
    assert.ok(!out.includes(addr), `full ETH address must be redacted; got: ${out}`);
    assert.ok(out.includes("paid"), `surrounding text 'paid' must survive; got: ${out}`);
    assert.ok(out.includes("to user"), `surrounding text 'to user' must survive; got: ${out}`);
  });

  it("is idempotent on clean text", () => {
    const clean = "hello world";
    assert.equal(redactText(clean), clean);
  });
});
