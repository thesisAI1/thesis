/**
 * TDD tests for admin quick-links feature (notifier.ts HTML formatting).
 *
 * Pin 1: payout:sent base → basescan tx link with full hash in href, truncated label
 * Pin 2: payout:sent solana → solscan.io links
 * Pin 3: trade:buy → explorerTokenUrl link; glyph Ξ base / ◎ solana
 * Pin 4: tweet:posted → two x.com/i/web/status/ links
 * Pin 5: error with <b> HTML + full wallet → HTML escaped + wallet truncated
 * Pin 6: admin send passes parseMode: "HTML"
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatOpsEvent, startNotifier } from "../src/adapters/telegram/notifier.js";
import { MockTelegram } from "../src/adapters/telegram/mock.js";
import { publishOps } from "../src/observability/opsBus.js";

const FULL_ETH_HASH =
  "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const FULL_ETH_WALLET = "0x1234567890abcdef1234567890abcdef12345678";
const FULL_SOL_ADDR = "SoLWaLLeTaddressABCDEFGHIJKLMNOPQRSTUVWXYZ12";
const FULL_SOL_TX =
  "5NfNmLHiYXtSZ9CkJNaRJoE4P2k6qA3LWuXvgP8TmKrBnVdCdEwQ1xYhZfRsNoPqRsTuVwXyZ1234567890";

// ── Pin 1: payout:sent base — basescan tx link ────────────────────────────────

describe("pin 1: payout:sent base — basescan tx link", () => {
  it("contains full hash ONLY inside href, label is truncated", () => {
    const out = formatOpsEvent({
      type: "payout:sent",
      at: "",
      path: "direct",
      chain: "base",
      handle: "@alice",
      amountEth: 0.5,
      wallet: FULL_ETH_WALLET,
      txHash: FULL_ETH_HASH,
    });

    assert.ok(out !== null, "should return string");
    // Full hash must appear in href
    assert.ok(
      out!.includes(`https://basescan.org/tx/${FULL_ETH_HASH}`),
      `href must contain full hash. Got: ${out}`,
    );
    // Full hash must NOT appear outside an href (only inside)
    // The visible label should be truncated
    const hrefRemoved = out!.replace(/<a href="[^"]*">[^<]*<\/a>/g, "LINK");
    assert.ok(
      !hrefRemoved.includes(FULL_ETH_HASH),
      `full hash must not appear outside href. Stripped: ${hrefRemoved}`,
    );
    // Wallet link present
    assert.ok(
      out!.includes(`https://basescan.org/address/${FULL_ETH_WALLET}`),
      `wallet href must use explorerAddrUrl. Got: ${out}`,
    );
  });
});

// ── Pin 2: payout:sent solana — solscan links ─────────────────────────────────

describe("pin 2: payout:sent solana — solscan links", () => {
  it("uses solscan.io/tx/ and /account/ for solana chain", () => {
    const out = formatOpsEvent({
      type: "payout:sent",
      at: "",
      path: "direct",
      chain: "solana",
      handle: "@bob",
      amountEth: 1.0,
      wallet: FULL_SOL_ADDR,
      txHash: FULL_SOL_TX,
    });

    assert.ok(out !== null, "should return string");
    assert.ok(
      out!.includes(`https://solscan.io/tx/${FULL_SOL_TX}`),
      `solana tx href must use solscan.io/tx/. Got: ${out}`,
    );
    assert.ok(
      out!.includes(`https://solscan.io/account/${FULL_SOL_ADDR}`),
      `solana wallet href must use solscan.io/account/. Got: ${out}`,
    );
  });
});

// ── Pin 3: trade:buy token link + glyph ─────────────────────────────────────

describe("pin 3: trade:buy — token link + chain glyph", () => {
  it("base: contains explorerTokenUrl link and Ξ glyph", () => {
    const contract = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const out = formatOpsEvent({
      type: "trade:buy",
      at: "",
      positionId: "p1",
      handle: "@carol",
      amountEth: 0.1,
      contract,
      chain: "base",
    });

    assert.ok(out !== null, "should return string");
    assert.ok(
      out!.includes(`https://basescan.org/token/${contract}`),
      `must contain token href. Got: ${out}`,
    );
    assert.ok(out!.includes("Ξ"), `must contain Ξ glyph for base. Got: ${out}`);
  });

  it("solana: contains solscan token link and ◎ glyph", () => {
    const mint = "SoLToKenMintAddressABCDEFGHIJKLMNOPQRSTUV";
    const out = formatOpsEvent({
      type: "trade:buy",
      at: "",
      positionId: "p2",
      handle: "@dave",
      amountEth: 0.05,
      contract: mint,
      chain: "solana",
    });

    assert.ok(out !== null, "should return string");
    assert.ok(
      out!.includes(`https://solscan.io/token/${mint}`),
      `must contain solscan token href. Got: ${out}`,
    );
    assert.ok(out!.includes("◎"), `must contain ◎ glyph for solana. Got: ${out}`);
  });
});

// ── Pin 4: tweet:posted — two x.com links ────────────────────────────────────

describe("pin 4: tweet:posted — two x.com/i/web/status/ links", () => {
  it("contains both reply and post links", () => {
    const replyId = "111222333444";
    const postId = "555666777888";
    const out = formatOpsEvent({
      type: "tweet:posted",
      at: "",
      kind: "buy",
      replyId,
      postId,
    });

    assert.ok(out !== null, "should return string");
    assert.ok(
      out!.includes(`https://x.com/i/web/status/${replyId}`),
      `must contain reply link. Got: ${out}`,
    );
    assert.ok(
      out!.includes(`https://x.com/i/web/status/${postId}`),
      `must contain post link. Got: ${out}`,
    );
  });
});

// ── Pin 5: error — HTML escaping + wallet truncation ─────────────────────────

describe("pin 5: error — <b> escaped + full wallet truncated", () => {
  it("escapes HTML in msg and does not leak full wallet address in plain text", () => {
    const msg = `<b>injection</b> failed for ${FULL_ETH_WALLET}`;
    const out = formatOpsEvent({
      type: "error",
      at: "",
      area: "payout",
      msg,
    });

    assert.ok(out !== null, "should return string");
    // <b> must be escaped
    assert.ok(
      out!.includes("&lt;b&gt;"),
      `<b> must be HTML-escaped. Got: ${out}`,
    );
    assert.ok(!out!.includes("<b>"), `raw <b> must not appear. Got: ${out}`);
    // Full wallet must not appear anywhere (redactText + esc)
    assert.ok(
      !out!.includes(FULL_ETH_WALLET),
      `full wallet must not appear in plain text. Got: ${out}`,
    );
  });
});

// ── Pin 6: admin send passes parseMode: "HTML" ───────────────────────────────

describe("pin 6: startNotifier passes parseMode HTML to adapter", () => {
  it("MockTelegram records parseMode: HTML for admin sends", async () => {
    const mock = new MockTelegram();
    const stop = startNotifier({ adapter: mock, allowedChats: ["999"], enabled: true });

    publishOps({ type: "error", at: "", area: "test", msg: "hello" });
    await new Promise<void>((r) => setImmediate(r));
    stop();

    assert.ok(mock.sent.length >= 1, "should have sent at least one message");
    const last = mock.sent[mock.sent.length - 1]!;
    assert.equal(
      last.parseMode,
      "HTML",
      `admin send must pass parseMode: "HTML". Got: ${JSON.stringify(last.parseMode)}`,
    );
  });
});
