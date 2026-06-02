/**
 * Guard test — the setMyCommands menus stay in sync with the handlers and obey
 * Telegram's command-name rules (no slash, lowercase [a-z0-9_], 1-32 chars).
 * Imports the menus only (the script self-guards its network call).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ADMIN_MENU, GROUP_MENU } from "../scripts/register-telegram-commands.js";
import { GROUP_COMMANDS } from "../src/adapters/telegram/groupCommands.js";

const NAME_RE = /^[a-z0-9_]{1,32}$/;
const DESC_OK = (d: string) => d.length >= 1 && d.length <= 256;

describe("telegram command menus — valid shape", () => {
  for (const [label, menu] of [["admin", ADMIN_MENU], ["group", GROUP_MENU]] as const) {
    it(`${label} menu names + descriptions satisfy Telegram rules`, () => {
      for (const c of menu) {
        assert.ok(NAME_RE.test(c.command), `bad command name: ${c.command}`);
        assert.ok(DESC_OK(c.description), `bad description for ${c.command}`);
      }
    });
  }
});

describe("group menu stays in sync with the handler", () => {
  it("every group menu command maps to a known GROUP_COMMANDS entry", () => {
    for (const c of GROUP_MENU) {
      assert.ok(
        GROUP_COMMANDS.has(`/${c.command}`),
        `group menu has /${c.command} but the handler doesn't know it`,
      );
    }
  });
});
