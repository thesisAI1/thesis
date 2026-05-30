import { config } from "../../config.js";
import { logEvent } from "../../util/log.js";
import { createTelegramAdapter, type TelegramAdapter, type TelegramUpdate } from "./index.js";
import { handleCommand, type StoreReads } from "./commands.js";
import { redactText } from "./redact.js";

export async function handleUpdate(
  update: TelegramUpdate,
  deps: { adapter: TelegramAdapter; allowedChats: string[]; store?: StoreReads },
): Promise<void> {
  if (!deps.allowedChats.includes(update.chatId)) {
    logEvent({
      level: "warn",
      area: "telegram",
      type: "cmd:denied",
      msg: `ignored command from non-allowlisted chat ${update.chatId}`,
    });
    return;
  }

  const reply = await handleCommand(update.text, update.chatId, {
    allowedChats: deps.allowedChats,
    store: deps.store,
  });

  if (reply) {
    await deps.adapter.sendMessage(update.chatId, reply);
  }
}

export function startBot(): () => void {
  if (!config.telegram.enabled || !config.telegram.botToken) return () => {};

  const adapter = createTelegramAdapter();
  const pollIntervalSec = config.telegram.pollIntervalSec;
  let offset: number | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function loop(): Promise<void> {
    if (stopped) return;
    try {
      const updates = await adapter.getUpdates(offset);
      for (const u of updates) {
        offset = u.updateId + 1;
        await handleUpdate(u, { adapter, allowedChats: config.telegram.allowedChats });
      }
    } catch (err) {
      logEvent({
        level: "error",
        area: "telegram",
        type: "poll:error",
        msg: redactText(`getUpdates loop failed: ${String(err)}`),
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
