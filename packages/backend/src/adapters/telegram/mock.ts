import type { TelegramAdapter, TelegramUpdate } from "./index.js";

export class MockTelegram implements TelegramAdapter {
  public sent: { chatId: string; text: string }[] = [];

  async sendMessage(chatId: string, text: string): Promise<boolean> {
    this.sent.push({ chatId, text });
    console.log("[telegram:mock] → " + chatId + ": " + text.split("\n")[0]);
    return true;
  }

  async getUpdates(_offset?: number): Promise<TelegramUpdate[]> {
    return [];
  }
}
