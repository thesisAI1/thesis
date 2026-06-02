import { config } from "../../config.js";
import { log } from "../../util/log.js";
import type { SendMessageOpts, TelegramAdapter, TelegramMediaSource, TelegramSendResult, TelegramUpdate } from "./index.js";
import { redactText } from "./redact.js";

interface TgResponse {
  ok: boolean;
  result: unknown;
}

interface TgMessage {
  message_id?: number;
  chat?: { id?: unknown };
  from?: { id?: unknown };
  text?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

interface TgMediaResult {
  animation?: { file_id?: string };
  video?: { file_id?: string };
}

export class RealTelegram implements TelegramAdapter {
  constructor(
    private readonly botToken: string = config.telegram.botToken,
    private readonly pollIntervalSec: number = config.telegram.pollIntervalSec,
  ) {}

  private get base() {
    return `https://api.telegram.org/bot${this.botToken}`;
  }

  /** Exposed for tests — lets callers verify the token without real network calls. */
  baseUrlForTest(): string {
    return this.base;
  }

  async sendMessage(chatId: string, text: string, opts?: SendMessageOpts): Promise<boolean> {
    if (!this.botToken) return false;

    try {
      const body: Record<string, unknown> = { chat_id: chatId, text };
      if (opts?.parseMode) {
        body["parse_mode"] = opts.parseMode;
        body["link_preview_options"] = { is_disabled: true };
      }
      const res = await fetch(`${this.base}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });

      const data = (await res.json()) as TgResponse;
      if (!res.ok) {
        log.warn(redactText(`telegram: sendMessage failed: ${JSON.stringify(data)}`));
        return false;
      }
      return true;
    } catch (err) {
      log.warn(redactText(`telegram: sendMessage network error: ${String(err)}`));
      return false;
    }
  }

  async getUpdates(offset?: number): Promise<TelegramUpdate[]> {
    if (!this.botToken) return [];

    const params = new URLSearchParams({ timeout: String(this.pollIntervalSec) });
    if (offset !== undefined) params.set("offset", String(offset));

    try {
      const res = await fetch(`${this.base}/getUpdates?${params}`, {
        signal: AbortSignal.timeout((this.pollIntervalSec * 2 + 5) * 1000),
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

        const fromId =
          msg.from?.id !== undefined && msg.from?.id !== null ? String(msg.from.id) : undefined;
        updates.push({
          updateId: u.update_id,
          chatId: String(msg.chat.id),
          text: msg.text,
          ...(fromId ? { fromId } : {}),
        });
      }

      return updates;
    } catch (err) {
      log.warn(redactText(`telegram: getUpdates network error: ${String(err)}`));
      return [];
    }
  }

  async sendAnimation(
    chatId: string,
    source: TelegramMediaSource,
    caption?: string,
  ): Promise<TelegramSendResult> {
    return this.#sendMedia("sendAnimation", "animation", chatId, source, caption);
  }

  async sendVideo(
    chatId: string,
    source: TelegramMediaSource,
    caption?: string,
  ): Promise<TelegramSendResult> {
    return this.#sendMedia("sendVideo", "video", chatId, source, caption);
  }

  async #sendMedia(
    endpoint: string,
    field: "animation" | "video",
    chatId: string,
    source: TelegramMediaSource,
    caption?: string,
  ): Promise<TelegramSendResult> {
    if (!this.botToken) return { ok: false };

    try {
      let res: Response;

      if ("path" in source) {
        // Multipart upload
        const { readFile } = await import("node:fs/promises");
        const buf = await readFile(source.path);
        const blob = new Blob([buf]);
        const form = new FormData();
        form.append("chat_id", chatId);
        form.append(field, blob, source.path.split("/").pop() ?? "file");
        if (caption) form.append("caption", caption);

        res = await fetch(`${this.base}/${endpoint}`, {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(60_000),
        });
      } else {
        // fileId or url — JSON body
        const mediaValue = "fileId" in source ? source.fileId : source.url;
        const body: Record<string, string> = { chat_id: chatId, [field]: mediaValue };
        if (caption) body.caption = caption;

        res = await fetch(`${this.base}/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
      }

      const data = (await res.json()) as TgResponse & { result?: TgMediaResult };
      if (!res.ok) {
        log.warn(redactText(`telegram: ${endpoint} failed: ${JSON.stringify(data)}`));
        return { ok: false };
      }

      const r = data.result as TgMediaResult | undefined;
      const fileId = r?.animation?.file_id ?? r?.video?.file_id ?? undefined;
      return { ok: true, ...(fileId ? { fileId } : {}) };
    } catch (err) {
      log.warn(redactText(`telegram: ${endpoint} network error: ${String(err)}`));
      return { ok: false };
    }
  }
}
