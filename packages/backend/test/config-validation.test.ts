/**
 * PR4 — Fail-fast config validation.
 *
 * The live hazard: `config.num()` is `Number(v)`, which silently yields NaN for
 * a typo'd env var ("3o" → NaN). A NaN stop-loss makes every `price <= threshold`
 * comparison false, so the stop-loss NEVER fires — the bot rides a losing trade
 * to zero, and nothing in the logs says why. `validateConfig()` turns that silent
 * NaN (and out-of-range / contradictory / live-without-a-key configs) into a loud
 * refusal to boot.
 *
 * `config.ts` reads process.env at module-evaluation time, so a value is frozen
 * on first import. To exercise the REAL env→parse→validate path per case, each
 * test boots the config module in a child process under a controlled env and
 * calls validateConfig(): exit 0 = accepted, non-zero = refused (reason on stderr).
 */

import "./helpers/isolate-store.js"; // pins THESIS_MODE/DATA_DIR in THIS process (harmless here)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const CONFIG_URL = new URL("../src/config.ts", import.meta.url).href;

/** Boot config.ts in a child process under a controlled env, call
 *  validateConfig(), and report the exit code + stderr. We strip the
 *  trading-relevant keys first so inherited env can never mask a case. */
function bootWith(overrides: Record<string, string | undefined>): {
  code: number;
  stderr: string;
} {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of [
    "THESIS_MODE",
    "STOP_LOSS_PCT",
    "POSITION_SIZE_MIN_PCT",
    "POSITION_SIZE_MAX_PCT",
    "SWAP_SLIPPAGE_PCT",
    "MIN_MARKET_CAP_USD",
    "MAX_MARKET_CAP_USD",
    "TRADING_WALLET_PRIVATE_KEY",
  ]) {
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

// --- the headline: a typo'd numeric must refuse to boot, not silently NaN ----

test("boot refuses a non-numeric STOP_LOSS_PCT (no silent NaN)", () => {
  const { code, stderr } = bootWith({ STOP_LOSS_PCT: "3o" });
  assert.notEqual(code, 0, "a NaN stop-loss must refuse to boot");
  assert.match(stderr, /STOP_LOSS_PCT/, "the refusal must name the offending var");
});

// --- the mock pipeline must still boot cleanly (no regression) ---------------

test("boot accepts the default mock config", () => {
  const { code, stderr } = bootWith({}); // THESIS_MODE unset ⇒ mock defaults
  assert.equal(code, 0, `default mock config must boot cleanly; stderr:\n${stderr}`);
});

// --- cross-field invariant: min <= max --------------------------------------

test("boot refuses POSITION_SIZE_MIN_PCT > POSITION_SIZE_MAX_PCT", () => {
  const { code, stderr } = bootWith({
    POSITION_SIZE_MIN_PCT: "20",
    POSITION_SIZE_MAX_PCT: "10",
  });
  assert.notEqual(code, 0, "min>max must refuse to boot");
  assert.match(stderr, /POSITION_SIZE_MIN_PCT/);
});

// --- range bound: a percentage out of [0,100] -------------------------------

test("boot refuses an out-of-range SWAP_SLIPPAGE_PCT", () => {
  const { code, stderr } = bootWith({ SWAP_SLIPPAGE_PCT: "150" });
  assert.notEqual(code, 0, "150% slippage must refuse to boot");
  assert.match(stderr, /SWAP_SLIPPAGE_PCT/);
});

// --- live mode requires a wallet key ----------------------------------------

test("boot refuses live mode without a trading wallet key", () => {
  const { code, stderr } = bootWith({
    THESIS_MODE: "live",
    TRADING_WALLET_PRIVATE_KEY: undefined,
  });
  assert.notEqual(code, 0, "live mode with no wallet key must refuse to boot");
  assert.match(stderr, /TRADING_WALLET_PRIVATE_KEY/);
});

// --- all problems reported at once (one boot tells the operator everything) --

test("boot reports multiple problems together", () => {
  const { code, stderr } = bootWith({
    STOP_LOSS_PCT: "nope",
    SWAP_SLIPPAGE_PCT: "999",
  });
  assert.notEqual(code, 0);
  assert.match(stderr, /STOP_LOSS_PCT/);
  assert.match(stderr, /SWAP_SLIPPAGE_PCT/);
});
