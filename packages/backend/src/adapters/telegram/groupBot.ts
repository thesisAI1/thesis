/**
 * Public group command bot (@thesistradebot) — a getUpdates poller that answers
 * the read-only community commands in groupCommands.ts.
 *
 * Distinct from:
 *   - the ADMIN bot (bot.ts) — allowlisted private ops commands;
 *   - the group NOTIFIER (groupNotifier.ts) — push-only broadcasts on the same
 *     group token. Each token has exactly ONE getUpdates consumer (this), so no
 *     409 conflict.
 *
 * Anti-spam: unknown commands / chatter are silent (Telegram privacy mode means
 * we only receive slash-commands anyway), and a per-user cooldown gate runs
 * BEFORE any store read so a known command can't be hammered.
 */

import { config } from "../../config.js";
import { logEvent } from "../../util/log.js";
import { createTelegramAdapter, type TelegramAdapter, type TelegramUpdate } from "./index.js";
import { handleGroupCommand, GROUP_COMMANDS, type GroupDeps } from "./groupCommands.js";
import { parseCommand } from "./parse.js";
import { redactText } from "./redact.js";

/** Per-key sliding gate. Returns true (and records `nowMs`) if the key is
 *  outside its window; false if it fired within `windowMs`. */
export function cooldownOk(
  state: Map<string, number>,
  key: string,
  nowMs: number,
  windowMs: number,
): boolean {
  const last = state.get(key);
  if (last !== undefined && nowMs - last < windowMs) return false;
  state.set(key, nowMs);
  return true;
}

export async function handleGroupUpdate(
  update: TelegramUpdate,
  deps: {
    adapter: TelegramAdapter;
    cooldown: Map<string, number>;
    cooldownMs: number;
    /** Only answer in this chat. When set, any other chat (incl. a 1:1 DM with
     *  the bot) is ignored — without this the public bot would answer ANY chat
     *  it's in, leaking leaderboard/open-positions/author records outside the
     *  community group. `undefined` = no restriction (handler reuse only). */
    allowedChatId?: string;
    now?: () => number;
    handler?: (text: string, d?: GroupDeps) => Promise<string | null>;
    group?: GroupDeps;
  },
): Promise<void> {
  // Scope gate FIRST — drop anything outside the configured community group.
  if (deps.allowedChatId !== undefined && update.chatId !== deps.allowedChatId) return;

  const { cmd } = parseCommand(update.text);
  // Gate on a KNOWN command — unknown text spends no cooldown slot and no
  // store read, and gets no reply (silent).
  if (!GROUP_COMMANDS.has(cmd)) return;

  const key = `${update.chatId}:${update.fromId ?? "anon"}`;
  const now = (deps.now ?? Date.now)();
  if (!cooldownOk(deps.cooldown, key, now, deps.cooldownMs)) return;

  const handler = deps.handler ?? handleGroupCommand;
  const reply = await handler(update.text, deps.group);
  if (reply) {
    await deps.adapter.sendMessage(update.chatId, reply, { parseMode: "HTML" });
  }
}

export function startGroupBot(): () => void {
  const g = config.telegram.group;
  // Need a token AND a chat id — the chat id is the scope gate (answers only
  // the community group). Missing any → bot stays dark (fail-closed).
  if (!g.enabled || !g.botToken || !g.chatId) return () => {};

  const pollIntervalSec = config.telegram.pollIntervalSec;
  const adapter = createTelegramAdapter({ botToken: g.botToken, pollIntervalSec });
  const cooldown = new Map<string, number>();
  const cooldownMs = g.cmdCooldownSec * 1000;
  const allowedChatId = g.chatId;

  let offset: number | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function loop(): Promise<void> {
    if (stopped) return;
    try {
      const updates = await adapter.getUpdates(offset);
      for (const u of updates) {
        offset = u.updateId + 1;
        await handleGroupUpdate(u, { adapter, cooldown, cooldownMs, allowedChatId });
      }
    } catch (err) {
      logEvent({
        level: "error",
        area: "telegram",
        type: "group:poll:error",
        msg: redactText(`group getUpdates loop failed: ${String(err)}`),
      });
    }
    if (!stopped) {
      timer = setTimeout(() => { void loop(); }, pollIntervalSec * 1000);
    }
  }

  void loop();

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
