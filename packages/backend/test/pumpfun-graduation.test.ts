/**
 * On-chain pump.fun graduation check (adapters/basedata/pumpfun-graduation.ts).
 *
 * Two layers, mirroring jupiter-parse's pure+IO split:
 *  - parseBondingCurveComplete: a PURE Buffer reader, pinned against the Anchor
 *    layout (8-byte discriminator + 5×u64 reserves → `complete` at offset 48).
 *    The discriminator/reserve bytes are filled non-zero so a wrong-offset read
 *    would pick up a non-{0,1} byte and the assertion would fail.
 *  - getPumpFunStatus: classifies via a STUBBED Connection (no RPC) across all
 *    four outcomes (null / wrong-owner → not_pumpfun, complete true → graduated,
 *    complete false → on_curve).
 *
 * The offset is pinned here against the documented layout; the live pin (a real
 * graduated + on-curve mint over RPC) is the pre-launch smoke test — out of
 * scope for this unit suite.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  PUMPFUN_PROGRAM_ID,
  bondingCurvePda,
  getPumpFunStatus,
  parseBondingCurveComplete,
} from "../src/adapters/basedata/pumpfun-graduation.js";

const MINT = new PublicKey("6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfpump");
const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");

/** A bonding-curve account buffer with the given `complete` flag. The
 *  discriminator + reserves (bytes 0..47) are filled 0xAB and the trailing
 *  creator pubkey (49..80) 0xCD, so a read at the wrong offset would pick up a
 *  non-{0,1} byte — making an off-by-N regression visible. */
function curveBuffer(complete: boolean): Buffer {
  const buf = Buffer.alloc(81);
  buf.fill(0xab, 0, 48);
  buf.writeUInt8(complete ? 1 : 0, 48);
  buf.fill(0xcd, 49);
  return buf;
}

/** A Connection whose getAccountInfo returns a fixed account (or null). Only
 *  `.owner` and `.data` are read by getPumpFunStatus, so the loose shape is safe. */
function stubConnection(account: { owner: PublicKey; data: Buffer } | null): Connection {
  return { getAccountInfo: async () => account } as unknown as Connection;
}

// --- parseBondingCurveComplete (pure) ---

test("parseBondingCurveComplete: reads complete=true at offset 48", () => {
  assert.equal(parseBondingCurveComplete(curveBuffer(true)), true);
});

test("parseBondingCurveComplete: reads complete=false at offset 48", () => {
  assert.equal(parseBondingCurveComplete(curveBuffer(false)), false);
});

test("parseBondingCurveComplete: throws on a too-short buffer (never silently passes)", () => {
  assert.throws(() => parseBondingCurveComplete(Buffer.alloc(40)), /too short/i);
});

test("parseBondingCurveComplete: throws on a non-{0,1} complete byte (fails closed, never coerces a rug to graduated)", () => {
  const buf = curveBuffer(false);
  buf.writeUInt8(0x02, 48);
  assert.throws(() => parseBondingCurveComplete(buf), /unexpected complete byte/i);
});

// --- bondingCurvePda ---

test('bondingCurvePda: derives the ["bonding-curve", mint] PDA under the pump.fun program', () => {
  const expected = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), MINT.toBuffer()],
    PUMPFUN_PROGRAM_ID,
  )[0];
  assert.ok(bondingCurvePda(MINT).equals(expected));
});

// --- getPumpFunStatus (stubbed Connection) ---

test("getPumpFunStatus: null account → not_pumpfun", async () => {
  assert.equal(await getPumpFunStatus(stubConnection(null), MINT), "not_pumpfun");
});

test("getPumpFunStatus: wrong owner → not_pumpfun (a look-alike account is rejected)", async () => {
  const acct = { owner: SYSTEM_PROGRAM, data: curveBuffer(true) };
  assert.equal(await getPumpFunStatus(stubConnection(acct), MINT), "not_pumpfun");
});

test("getPumpFunStatus: pump.fun-owned + complete=true → graduated", async () => {
  const acct = { owner: PUMPFUN_PROGRAM_ID, data: curveBuffer(true) };
  assert.equal(await getPumpFunStatus(stubConnection(acct), MINT), "graduated");
});

test("getPumpFunStatus: pump.fun-owned + complete=false → on_curve (NOT graduated)", async () => {
  const acct = { owner: PUMPFUN_PROGRAM_ID, data: curveBuffer(false) };
  assert.equal(await getPumpFunStatus(stubConnection(acct), MINT), "on_curve");
});
