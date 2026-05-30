import { config } from "../../config.js";
import { log } from "../../util/log.js";
import type { TelegramAdapter, TelegramUpdate } from "./index.js";
import { redactText } from "./redact.js";

const BASE = `https://api.telegram.org/bot${config.telegram.botToken}`;

interface TgResponse {
  ok: boolean;
  result: unknown;
}

interface TgMessage {
  message_id?: number;
  chat?: { id?: unknown };
  text?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

export class RealTelegram implements TelegramAdapter {
  async sendMessage(chatId: string, text: string): Promise<boolean> {
    if (!config.telegram.botToken) return false;

    const res = await fetch(`${BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(15_000),
    });

    const data = (await res.json()) as TgResponse;
    if (!res.ok) {
      log.warn(redactText(`telegram: sendMessage failed: ${JSON.stringify(data)}`));
      return false;
    }
    return true;
  }

  async getUpdates(offset?: number): Promise<TelegramUpdate[]> {
    if (!config.telegram.botToken) return [];

    const params = new URLSearchParams({ timeout: String(config.telegram.pollIntervalSec) });
    if (offset !== undefined) params.set("offset", String(offset));

    const res = await fetch(`${BASE}/getUpdates?${params}`, {
      signal: AbortSignal.timeout((config.telegram.pollIntervalSec * 2 + 5) * 1000),
    });
    const data = (await res.json()) as TgResponse;

    if (!res.ok) {
      log.warn(redactText(`telegram: getUpdates failed: ${JSON.stringify(data)}`));
      return [];
    }

    if (!Array.isArray(data.result)) return [];

    const results = data.result as TgUpdate[];
    const updates: TelegramUpdate[] = [];

    for (const u of results) {
      const msg = u.message;
      if (!msg) continue;
      if (typeof msg.text !== "string") continue;
      if (msg.chat?.id === undefined || msg.chat?.id === null) continue;

      updates.push({
        updateId: u.update_id,
        chatId: String(msg.chat.id),
        text: msg.text,
      });
    }

    return updates;
  }
}
