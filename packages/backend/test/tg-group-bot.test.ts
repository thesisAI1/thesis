/**
 * RED → GREEN — public group bot poller plumbing:
 *   - cooldownOk: per-key window gate
 *   - handleGroupUpdate: known command → HTML reply; unknown → silent (no send,
 *     no cooldown burn); per-user cooldown drops a 2nd call but not another user.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { cooldownOk, handleGroupUpdate } from "../src/adapters/telegram/groupBot.js";
import { MockTelegram } from "../src/adapters/telegram/mock.js";
import type { TelegramUpdate } from "../src/adapters/telegram/index.js";

const GROUP = "-100123";
const upd = (text: string, fromId?: string): TelegramUpdate => updChat(text, GROUP, fromId);
const updChat = (text: string, chatId: string, fromId?: string): TelegramUpdate => ({
  updateId: 1,
  chatId,
  text,
  ...(fromId ? { fromId } : {}),
});

// A fake handler so the poller test never touches the store.
const handler = async (text: string) => (text.startsWith("/stats") ? "<b>stats</b>" : null);

describe("cooldownOk", () => {
  it("first call allowed, repeat within window blocked, allowed again after window", () => {
    const state = new Map<string, number>();
    assert.equal(cooldownOk(state, "k", 1_000, 30_000), true);
    assert.equal(cooldownOk(state, "k", 5_000, 30_000), false);
    assert.equal(cooldownOk(state, "k", 40_000, 30_000), true);
  });
});

describe("handleGroupUpdate", () => {
  function setup() {
    const adapter = new MockTelegram();
    const cooldown = new Map<string, number>();
    let t = 0;
    const now = () => t;
    const advance = (ms: number) => { t += ms; };
    const base = { adapter, cooldown, cooldownMs: 30_000, now, handler, allowedChatId: GROUP };
    return { adapter, advance, base };
  }

  it("SECURITY: ignores a command from a chat other than the configured group", async () => {
    const { adapter, base } = setup();
    await handleGroupUpdate(updChat("/stats", "999999", "u1"), base); // foreign chat / DM
    assert.equal(adapter.sent.length, 0, "must not answer outside the community group");
  });

  it("known command → sends reply with HTML parse mode", async () => {
    const { adapter, base } = setup();
    await handleGroupUpdate(upd("/stats", "u1"), base);
    assert.equal(adapter.sent.length, 1);
    assert.equal(adapter.sent[0]!.parseMode, "HTML");
    assert.ok(adapter.sent[0]!.text.includes("stats"));
  });

  it("unknown command → silent (no send) and burns no cooldown", async () => {
    const { adapter, base } = setup();
    await handleGroupUpdate(upd("/notacmd", "u1"), base);
    assert.equal(adapter.sent.length, 0);
    // the same user can immediately run a real command (cooldown not consumed)
    await handleGroupUpdate(upd("/stats", "u1"), base);
    assert.equal(adapter.sent.length, 1);
  });

  it("per-user cooldown drops a quick repeat but not another user", async () => {
    const { adapter, advance, base } = setup();
    await handleGroupUpdate(upd("/stats", "u1"), base); // sent
    await handleGroupUpdate(upd("/stats", "u1"), base); // dropped (within window)
    assert.equal(adapter.sent.length, 1);
    await handleGroupUpdate(upd("/stats", "u2"), base); // different user → sent
    assert.equal(adapter.sent.length, 2);
    advance(31_000);
    await handleGroupUpdate(upd("/stats", "u1"), base); // window passed → sent
    assert.equal(adapter.sent.length, 3);
  });
});
