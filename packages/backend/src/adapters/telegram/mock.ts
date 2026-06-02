import type { SendMessageOpts, TelegramAdapter, TelegramMediaSource, TelegramSendResult, TelegramUpdate } from "./index.js";

export class MockTelegram implements TelegramAdapter {
  public sent: { chatId: string; text: string; parseMode?: "HTML" }[] = [];
  public sentAnimations: { chatId: string; source: TelegramMediaSource; caption?: string }[] = [];
  public sentVideos: { chatId: string; source: TelegramMediaSource; caption?: string }[] = [];

  async sendMessage(chatId: string, text: string, opts?: SendMessageOpts): Promise<boolean> {
    this.sent.push({ chatId, text, ...(opts?.parseMode ? { parseMode: opts.parseMode } : {}) });
    console.log("[telegram:mock] → " + chatId + ": " + text.split("\n")[0]);
    return true;
  }

  async getUpdates(_offset?: number): Promise<TelegramUpdate[]> {
    return [];
  }

  async sendAnimation(
    chatId: string,
    source: TelegramMediaSource,
    caption?: string,
  ): Promise<TelegramSendResult> {
    this.sentAnimations.push({ chatId, source, caption });
    return { ok: true, fileId: "mock-file-id" };
  }

  async sendVideo(
    chatId: string,
    source: TelegramMediaSource,
    caption?: string,
  ): Promise<TelegramSendResult> {
    this.sentVideos.push({ chatId, source, caption });
    return { ok: true, fileId: "mock-file-id" };
  }
}
