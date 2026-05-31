/**
 * Wave 1 — chain helpers (util/chains.ts).
 *
 * Native unit + block-explorer differ per chain. The pipeline reuses the
 * `*Eth` fields as native units (SOL on Solana, ETH on Base), and X replies /
 * the profit card / the new website need the right symbol and explorer host
 * from a position's chain. These pin the helper contract.
 *
 * RED until util/chains.ts exists; GREEN once it lands.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEvm,
  nativeSymbol,
  nativeGlyph,
  explorerTxUrl,
  explorerAddrUrl,
  explorerTokenUrl,
} from "../src/util/chains.js";

test("isEvm: base is EVM, solana is not", () => {
  assert.equal(isEvm("base"), true);
  assert.equal(isEvm("base-sepolia"), true);
  assert.equal(isEvm("solana"), false);
});

test("nativeSymbol: ETH for base, SOL for solana", () => {
  assert.equal(nativeSymbol("base"), "ETH");
  assert.equal(nativeSymbol("solana"), "SOL");
});

test("nativeGlyph: Ξ for base, ◎ for solana", () => {
  assert.equal(nativeGlyph("base"), "Ξ");
  assert.equal(nativeGlyph("solana"), "◎");
});

test("explorerTxUrl: BaseScan for base, Solscan for solana", () => {
  assert.match(explorerTxUrl("base", "0xabc"), /basescan\.org\/tx\/0xabc/);
  assert.match(explorerTxUrl("solana", "5sig"), /solscan\.io\/tx\/5sig/);
});

test("explorerAddrUrl: chain-correct host", () => {
  assert.match(explorerAddrUrl("base", "0xabc"), /basescan\.org\/address\/0xabc/);
  assert.match(explorerAddrUrl("solana", "Wallet1"), /solscan\.io\/account\/Wallet1/);
});

test("explorerTokenUrl: chain-correct host", () => {
  assert.match(explorerTokenUrl("base", "0xtok"), /basescan\.org\/token\/0xtok/);
  assert.match(explorerTokenUrl("solana", "Mint1"), /solscan\.io\/token\/Mint1/);
});
