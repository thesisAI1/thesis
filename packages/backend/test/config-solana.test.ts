/**
 * Wave 2 — Solana config block + validation.
 *
 * Solana support is ADDITIVE and OPTIONAL: the default mock config and existing
 * Base-only live deployments must boot unchanged (no new hard requirement). But
 * a typo'd SOLANA_SLIPPAGE_PCT must refuse to boot, exactly like SWAP_SLIPPAGE_PCT
 * — same silent-NaN hazard.
 *
 * RED today: there is no `config.solana` and SOLANA_SLIPPAGE_PCT is not
 * validated, so an out-of-range value boots silently (code 0) and the defaults
 * assertion throws. GREEN once the block + range check land.
 */

import "./helpers/isolate-store.js"; // pins THESIS_MODE/DATA_DIR in THIS process
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { config } from "../src/config.js";

const CONFIG_URL = new URL("../src/config.ts", import.meta.url).href;

function bootWith(overrides: Record<string, string | undefined>): {
  code: number;
  stderr: string;
} {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["THESIS_MODE", "SOLANA_SLIPPAGE_PCT", "TRADING_WALLET_PRIVATE_KEY"]) {
    delete env[k];
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const script =
    `import(${JSON.stringify(CONFIG_URL)})` +
    `.then((m) => { m.validateConfig(); process.exit(0); })` +
    `.catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });`;
  const res = spawnSync(process.execPath, ["--import", "tsx", "-e", script], {
    env,
    encoding: "utf8",
  });
  return { code: res.status ?? -1, stderr: res.stderr ?? "" };
}

test("boot refuses an out-of-range SOLANA_SLIPPAGE_PCT", () => {
  const { code, stderr } = bootWith({ SOLANA_SLIPPAGE_PCT: "150" });
  assert.notEqual(code, 0, "150% Solana slippage must refuse to boot");
  assert.match(stderr, /SOLANA_SLIPPAGE_PCT/, "the refusal must name the offending var");
});

test("boot still accepts the default mock config (Solana optional)", () => {
  const { code, stderr } = bootWith({});
  assert.equal(code, 0, `default mock config must boot cleanly; stderr:\n${stderr}`);
});

test("config.solana exposes sensible defaults", () => {
  assert.equal(config.solana.wsolMint, "So11111111111111111111111111111111111111112");
  assert.match(config.solana.jupiterApiBase, /jup\.ag/);
  assert.equal(config.solana.slippagePct, 8);
  assert.ok(config.solana.rpcUrl.length > 0, "a default Solana RPC URL must be present");
});

// Incident 2026-06-04: prod (Helius RPC, jito mode) abandoned 24/24 Solana buys.
// Root cause = the per-attempt blockhash window default of 16 slots (~6.5s) is too
// short for a Jito bundle to reach a bundle-accepting validator before the
// blockhash dies — a 3.29M-lamport tip (HIGHER than the 1.6M tip that historically
// landed) still expired. Double-fill safety comes from confirmOrExpire's
// sequential confirm-then-escalate, NOT from a short window, so the window must be
// long enough to actually land. Guard: the default must give a realistic window.
test("config.solana: default blockhash window is long enough to land a bundle", () => {
  assert.ok(
    config.solana.jitoBlockhashSlotsToExpiry >= 32,
    `blockhash window ${config.solana.jitoBlockhashSlotsToExpiry} slots (~${(
      config.solana.jitoBlockhashSlotsToExpiry * 0.4
    ).toFixed(1)}s) is too short — 16 slots (~6.5s) expired even auction-winning bundles in prod`,
  );
});
