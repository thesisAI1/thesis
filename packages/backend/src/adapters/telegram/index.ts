import { useMock } from "../../config.js";
import { MockTelegram } from "./mock.js";
import { RealTelegram } from "./real.js";

export interface TelegramUpdate {
  updateId: number;
  chatId: string;
  text: string;
}

export interface TelegramAdapter {
  sendMessage(chatId: string, text: string): Promise<boolean>;
  getUpdates(offset?: number): Promise<TelegramUpdate[]>;
}

export function createTelegramAdapter(): TelegramAdapter {
  return useMock() ? new MockTelegram() : new RealTelegram();
}
