/**
 * RED tests for /recent address redaction.
 * handleCommand("/recent") currently prints event log messages verbatim,
 * so the full ETH address leaks through. These tests FAIL until redactText()
 * is applied in the /recent handler.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { handleCommand } from "../src/adapters/telegram/commands.js";
import { getEventLog } from "../src/observability/eventLog.js";

const FULL_ADDR = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

describe("handleCommand /recent — address redaction (AC8)", () => {
  it("does NOT leak a full ETH address recorded in the event log", async () => {
    // Seed the shared singleton with an entry containing a raw address.
    getEventLog().record({
      at: new Date().toISOString(),
      level: "error",
      area: "payout",
      type: "x",
      msg: `sent to ${FULL_ADDR} failed`,
    });

    // {} as unknown as store — /recent reads getEventLog(), not the store.
    const out = await handleCommand("/recent", "111", {
      allowedChats: ["111"],
      store: {} as unknown as Parameters<typeof handleCommand>[2] extends {
        store?: infer S;
      }
        ? S
        : never,
    });

    assert.ok(out !== null, "/recent must return a string for an allowlisted chat");
    assert.ok(
      !out!.includes(FULL_ADDR),
      `SECURITY: full ETH address must be redacted in /recent output; got: ${out}`,
    );
  });
});
