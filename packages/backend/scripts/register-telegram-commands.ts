/**
 * Register the Telegram "/" autocomplete menus for both bots via setMyCommands.
 * Run once after a deploy (idempotent). Reads tokens from the environment via
 * `config`; a bot with a blank token is skipped (so dev/mock runs are a no-op).
 *
 *   tsx packages/backend/scripts/register-telegram-commands.ts
 *
 * Telegram command names: no leading slash, lowercase, [a-z0-9_], 1-32 chars.
 */

import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";

export interface BotCommand {
  command: string;
  description: string;
}

/** Admin ops bot (@thesislogbot) — mirrors handleCommand's switch. */
export const ADMIN_MENU: BotCommand[] = [
  { command: "status", description: "Open positions + triage funnel" },
  { command: "positions", description: "Open positions (detail)" },
  { command: "pnl", description: "Realized PnL + author payouts" },
  { command: "stats", description: "Funnel · reviews · buys" },
  { command: "recent", description: "Recent event log" },
  { command: "help", description: "List commands" },
];

/** Public group bot (@thesistradebot) — mirrors handleGroupCommand's switch. */
export const GROUP_MENU: BotCommand[] = [
  { command: "stats", description: "Committee track record" },
  { command: "leaderboard", description: "Top-earning authors" },
  { command: "author", description: "An author's record — /author @handle" },
  { command: "recent", description: "Recent closed trades" },
  { command: "open", description: "Current open positions" },
  { command: "check", description: "Was a token reviewed? — /check WIF" },
  { command: "how", description: "How to submit a thesis" },
  { command: "links", description: "Official links" },
  { command: "rules", description: "Community rules" },
  { command: "help", description: "List commands" },
];

export async function setMyCommands(
  token: string,
  label: string,
  commands: BotCommand[],
): Promise<boolean> {
  if (!token) {
    console.log(`[skip] ${label}: no token configured`);
    return false;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  console.log(
    data.ok
      ? `[ok] ${label}: ${commands.length} commands registered`
      : `[FAIL] ${label}: ${data.description ?? "unknown error"}`,
  );
  return data.ok;
}

export async function registerAll(): Promise<void> {
  await setMyCommands(config.telegram.botToken, "admin @thesislogbot", ADMIN_MENU);
  await setMyCommands(config.telegram.group.botToken, "group @thesistradebot", GROUP_MENU);
}

// Run only when invoked directly (so tests can import the menus without firing).
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  registerAll().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
