import { useMock } from "../../config.js";
import { MockTelegram } from "./mock.js";
import { RealTelegram } from "./real.js";

export interface TelegramUpdate {
  updateId: number;
  chatId: string;
  text: string;
}

export type TelegramMediaSource = { path: string } | { fileId: string } | { url: string };

export interface TelegramSendResult {
  ok: boolean;
  fileId?: string;
}

export interface SendMessageOpts {
  parseMode?: "HTML";
}

export interface TelegramAdapter {
  sendMessage(chatId: string, text: string, opts?: SendMessageOpts): Promise<boolean>;
  getUpdates(offset?: number): Promise<TelegramUpdate[]>;
  sendAnimation(chatId: string, source: TelegramMediaSource, caption?: string): Promise<TelegramSendResult>;
  sendVideo(chatId: string, source: TelegramMediaSource, caption?: string): Promise<TelegramSendResult>;
}

export interface CreateTelegramAdapterOpts {
  botToken?: string;
  pollIntervalSec?: number;
}

export function createTelegramAdapter(opts?: CreateTelegramAdapterOpts): TelegramAdapter {
  if (useMock()) return new MockTelegram();
  return new RealTelegram(opts?.botToken, opts?.pollIntervalSec);
}
