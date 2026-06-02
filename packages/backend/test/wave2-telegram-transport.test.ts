/**
 * Wave 2 tests — Telegram transport plumbing: media sends, token params, asset registry.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MockTelegram } from "../src/adapters/telegram/mock.js";
import { RealTelegram } from "../src/adapters/telegram/real.js";
import { resolveAsset, rememberFileId, clearFileIdCache } from "../src/adapters/telegram/assets.js";

// ---------------------------------------------------------------------------
// MockTelegram — sendAnimation / sendVideo
// ---------------------------------------------------------------------------

describe("MockTelegram media sends", () => {
  it("sendAnimation records call and returns ok + fileId", async () => {
    const m = new MockTelegram();
    const result = await m.sendAnimation("chat1", { url: "https://example.com/a.gif" }, "buy!");

    assert.equal(result.ok, true);
    assert.equal(result.fileId, "mock-file-id");
    assert.equal(m.sentAnimations.length, 1);
    assert.deepEqual(m.sentAnimations[0], {
      chatId: "chat1",
      source: { url: "https://example.com/a.gif" },
      caption: "buy!",
    });
  });

  it("sendVideo records call and returns ok + fileId", async () => {
    const m = new MockTelegram();
    const result = await m.sendVideo("chat2", { fileId: "FILEID123" });

    assert.equal(result.ok, true);
    assert.equal(result.fileId, "mock-file-id");
    assert.equal(m.sentVideos.length, 1);
    assert.deepEqual(m.sentVideos[0], {
      chatId: "chat2",
      source: { fileId: "FILEID123" },
      caption: undefined,
    });
  });

  it("per-instance animation arrays are isolated", async () => {
    const m1 = new MockTelegram();
    const m2 = new MockTelegram();
    await m1.sendAnimation("c", { url: "u" });
    assert.equal(m1.sentAnimations.length, 1);
    assert.equal(m2.sentAnimations.length, 0);
  });
});

// ---------------------------------------------------------------------------
// RealTelegram — constructor token parameterisation
// ---------------------------------------------------------------------------

describe("RealTelegram token parameterisation", () => {
  it("two instances with different tokens have independent base URLs", () => {
    const r1 = new RealTelegram("TOKEN_A");
    const r2 = new RealTelegram("TOKEN_B");

    assert.ok(r1.baseUrlForTest().includes("TOKEN_A"), "r1 base must contain TOKEN_A");
    assert.ok(r2.baseUrlForTest().includes("TOKEN_B"), "r2 base must contain TOKEN_B");
    assert.notEqual(r1.baseUrlForTest(), r2.baseUrlForTest());
  });

  it("default constructor (no args) builds URL from config.telegram.botToken", () => {
    // No TELEGRAM_BOT_TOKEN set in this test env → empty string → URL ends with /bot
    const r = new RealTelegram();
    assert.ok(r.baseUrlForTest().startsWith("https://api.telegram.org/bot"));
  });

  it("sendMessage returns false when token is empty (no network call)", async () => {
    const r = new RealTelegram("");
    const result = await r.sendMessage("chat", "hello");
    assert.equal(result, false);
  });

  it("sendAnimation returns {ok:false} when token is empty (no network call)", async () => {
    const r = new RealTelegram("");
    const result = await r.sendAnimation("chat", { url: "https://x.com/a.gif" });
    assert.deepEqual(result, { ok: false });
  });

  it("sendVideo returns {ok:false} when token is empty (no network call)", async () => {
    const r = new RealTelegram("");
    const result = await r.sendVideo("chat", { fileId: "ABC" });
    assert.deepEqual(result, { ok: false });
  });
});

// ---------------------------------------------------------------------------
// Asset registry
// ---------------------------------------------------------------------------

describe("resolveAsset / rememberFileId", () => {
  beforeEach(() => {
    clearFileIdCache();
  });

  it("returns null when no file exists and no cache", () => {
    const dir = join(tmpdir(), `thesis-telegram-test-absent-${Date.now()}`);
    // dir does not exist, so no file present
    const result = resolveAsset("buy", dir);
    assert.equal(result, null);
  });

  it("returns { path } when asset file exists on disk", () => {
    const dir = join(tmpdir(), `thesis-telegram-test-present-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "buy.mp4"), "fake-video-data");

    const result = resolveAsset("buy", dir);
    assert.ok(result !== null);
    assert.ok("path" in result, "should return { path } when file exists");
    assert.ok((result as { path: string }).path.endsWith("buy.mp4"));
  });

  it("returns { fileId } after rememberFileId (cache takes precedence over disk)", () => {
    const dir = join(tmpdir(), `thesis-telegram-test-cached-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "tp.mp4"), "fake-video-data");

    // First: file present → returns path
    const before = resolveAsset("tp", dir);
    assert.ok(before !== null && "path" in before);

    // Cache the file_id
    rememberFileId("tp", "REAL_FILE_ID");

    // Now: cache takes precedence
    const after = resolveAsset("tp", dir);
    assert.ok(after !== null && "fileId" in after);
    assert.equal((after as { fileId: string }).fileId, "REAL_FILE_ID");
  });

  it("cache is per-kind — caching 'buy' does not affect 'tp'", () => {
    const dir = join(tmpdir(), `thesis-telegram-test-per-kind-${Date.now()}`);
    rememberFileId("buy", "BUY_FID");

    const tp = resolveAsset("tp", dir);
    assert.equal(tp, null, "tp should not be affected by buy cache");

    const buy = resolveAsset("buy", dir);
    assert.ok(buy !== null && "fileId" in buy);
  });

  it("clearFileIdCache resets all entries", () => {
    rememberFileId("buy", "BUY_FID");
    clearFileIdCache();
    const dir = join(tmpdir(), `thesis-telegram-test-clear-${Date.now()}`);
    const result = resolveAsset("buy", dir);
    assert.equal(result, null);
  });
});
