/**
 * Wave 8 — X-facing output is chain-aware.
 *
 * Exit replies + the profit-close card are posted to X on every close. For a
 * Solana trade they must read SOL (not ETH), link Solscan (not BaseScan), and
 * NOT claim a "$THESIS burn" (Solana has none — the slice goes to a wallet).
 * Base output is unchanged.
 *
 * Pure renderers — no store/config.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { exitReplyText } from "../src/util/replies.js";
import { renderProfitCardSvg, type ProfitCardData } from "../src/cards/profit-card.js";

test("exitReplyText: Solana close reads SOL + Solscan, no burn wording", () => {
  const txt = exitReplyText({ kind: "manual", netPnlEth: 0.5, tiersHit: 1, txHash: "SiGnAtUre" }, "solana");
  assert.match(txt, /SOL\./, "amount denominated in SOL");
  assert.match(txt, /solscan\.io\/tx\/SiGnAtUre/, "links Solscan");
  assert.doesNotMatch(txt, /burn/i, "no $THESIS burn claim on Solana");
  assert.match(txt, /treasury split/i, "Solana settlement wording");
});

test("exitReplyText: Base close is unchanged (ETH + BaseScan + burn)", () => {
  const txt = exitReplyText({ kind: "manual", netPnlEth: 0.5, tiersHit: 1, txHash: "0xabc" }, "base");
  assert.match(txt, /ETH\./);
  assert.match(txt, /basescan\.org\/tx\/0xabc/);
  assert.match(txt, /burn/i);
});

function cardData(chain: "base" | "solana"): ProfitCardData {
  return {
    tokenSymbol: "PUMP",
    chain,
    authorHandle: "@author",
    totalProfitEth: 1.2,
    pnlPct: 120,
    entryMarketCapUsd: 40000,
    exitMarketCapUsd: 90000,
    authorShareEth: 0.3,
    buybackEth: 0.3,
    exit: { kind: "tp", tier: 1, gainPct: 100, final: true },
  };
}

test("profit card: Solana shows SOL + buyback wallet (no burn)", () => {
  const svg = renderProfitCardSvg(cardData("solana"));
  assert.match(svg, /SOL/);
  assert.match(svg, /buyback wallet/i);
  assert.doesNotMatch(svg, /\$THESIS BURNED/);
  assert.match(svg, /COMMITTEE · SOLANA/);
});

test("profit card: Base shows ETH + $THESIS burn (unchanged)", () => {
  const svg = renderProfitCardSvg(cardData("base"));
  assert.match(svg, /ETH/);
  assert.match(svg, /\$THESIS BURNED/);
  assert.match(svg, /COMMITTEE · BASE/);
});
