/**
 * RED → GREEN — shared helpers for the Telegram command surface.
 *   - chartUrl(chain, contract): per-chain DexScreener chart link
 *   - parseCommand(text): strip a trailing @botusername and split cmd/arg
 * Both are pure; no store/network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { chartUrl } from "../src/util/chains.js";
import { parseCommand } from "../src/adapters/telegram/parse.js";

describe("chartUrl", () => {
  it("base contract → dexscreener /base/", () => {
    assert.equal(
      chartUrl("base", "0xAbC123"),
      "https://dexscreener.com/base/0xAbC123",
    );
  });
  it("solana mint → dexscreener /solana/", () => {
    assert.equal(
      chartUrl("solana", "MintAddr111"),
      "https://dexscreener.com/solana/MintAddr111",
    );
  });
  it("unknown/testnet falls back to base slug (still a valid link)", () => {
    assert.ok(chartUrl("unknown", "0xZ").startsWith("https://dexscreener.com/"));
  });
});

describe("parseCommand — strips @botusername suffix (group menu-tap fix)", () => {
  it("bare command", () => {
    assert.deepEqual(parseCommand("/status"), { cmd: "/status", arg: "" });
  });
  it("command with @mention suffix resolves to the bare command", () => {
    assert.deepEqual(parseCommand("/status@thesislogbot"), { cmd: "/status", arg: "" });
  });
  it("command + arg", () => {
    assert.deepEqual(parseCommand("/author @alice"), { cmd: "/author", arg: "@alice" });
  });
  it("command@mention + arg", () => {
    assert.deepEqual(parseCommand("/author@thesistradebot @alice"), {
      cmd: "/author",
      arg: "@alice",
    });
  });
  it("lowercases the command, preserves + trims the arg", () => {
    assert.deepEqual(parseCommand("  /CHECK   WIF "), { cmd: "/check", arg: "WIF" });
  });
});
