/**
 * Parse a Telegram command line into `{ cmd, arg }`.
 *
 * Strips a trailing `@botusername` from the command token so menu-tapped
 * commands in groups (`/status@thesislogbot`) resolve to the bare command —
 * Telegram appends the bot's username when a command is tapped from the menu
 * or when more than one bot is present. The command is lowercased; the argument
 * (everything after the first space) is preserved and trimmed.
 */
export function parseCommand(text: string): { cmd: string; arg: string } {
  const trimmed = text.trim();
  const sp = trimmed.search(/\s/);
  const head = sp === -1 ? trimmed : trimmed.slice(0, sp);
  const arg = sp === -1 ? "" : trimmed.slice(sp + 1).trim();
  const cmd = head.split("@")[0]!.toLowerCase();
  return { cmd, arg };
}
