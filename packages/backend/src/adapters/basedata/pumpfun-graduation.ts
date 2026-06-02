/**
 * pump.fun bonding-curve graduation check — authoritative, ON-CHAIN.
 *
 * A Solana token is trusted only once it has GENUINELY graduated: its pump.fun
 * bonding-curve account carries `complete === true`. At completion the protocol
 * migrates the liquidity to a locked LP (PumpSwap / Raydium) the dev cannot
 * pull, so the LP-rug risk is gone. A token that merely shows up on PumpSwap
 * WITHOUT a completed curve (dev-seeded, dev-pullable LP) must be rejected — so
 * we read the curve account directly rather than trusting a mint suffix or a
 * DexScreener dexId (which "pumpswap" carries for both genuine and fake pools).
 *
 * Pure-parser + thin-IO split mirrors jupiter-parse.ts: parseBondingCurveComplete
 * is a pure Buffer reader (fixture-testable, no RPC); getPumpFunStatus does the
 * single getAccountInfo and classifies.
 */

import { Connection, PublicKey } from "@solana/web3.js";

/** The pump.fun bonding-curve program. Every curve account is a PDA it owns. */
export const PUMPFUN_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
);

/** Trust state of a Solana mint with respect to pump.fun. */
export type PumpFunStatus = "not_pumpfun" | "on_curve" | "graduated";

/**
 * Byte offset of the `complete` flag inside a bonding-curve account.
 *
 * Anchor account layout (little-endian):
 *   [0..8)   8-byte account discriminator
 *   [8..16)  virtualTokenReserves : u64
 *   [16..24) virtualSolReserves   : u64
 *   [24..32) realTokenReserves    : u64
 *   [32..40) realSolReserves      : u64
 *   [40..48) tokenTotalSupply     : u64
 *   [48]     complete             : bool   ← here (8 + 5×8)
 *   [49..81) creator              : pubkey (added 2025, AFTER complete — so this
 *                                           offset is unaffected by that change)
 */
const COMPLETE_OFFSET = 48;

/** Derive the bonding-curve PDA for a mint: ["bonding-curve", mint] under the
 *  pump.fun program. The curve account never moves, so this is stable across a
 *  token's whole life (on-curve through graduated). */
export function bondingCurvePda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMPFUN_PROGRAM_ID,
  )[0];
}

/**
 * Read the `complete` flag from a raw bonding-curve account buffer. PURE.
 * `complete` flips true exactly when the curve finishes and liquidity migrates.
 */
export function parseBondingCurveComplete(data: Buffer): boolean {
  if (data.length <= COMPLETE_OFFSET) {
    throw new Error(
      `bonding-curve account too short: ${data.length} bytes (need > ${COMPLETE_OFFSET})`,
    );
  }
  // Fail CLOSED on an ambiguous byte. No verified 8-byte Anchor discriminator
  // is pinned in-repo, so we can't pre-validate the account shape; the residual
  // risk is a non-curve account whose byte 48 happens to be 0x00/0x01. Rejecting
  // anything other than {0,1} closes the dangerous direction: a corrupt / shifted
  // / look-alike layout can no longer coerce a non-1 byte into "graduated" (buy).
  const flag = data.readUInt8(COMPLETE_OFFSET);
  if (flag !== 0 && flag !== 1) {
    throw new Error(
      `pumpfun: unexpected complete byte ${flag} at offset ${COMPLETE_OFFSET} — refusing to classify`,
    );
  }
  return flag === 1;
}

/**
 * Classify a mint's pump.fun status by reading its bonding-curve account.
 *   - no account, or not owned by the pump.fun program → not_pumpfun
 *   - account present, complete=false                  → on_curve (NOT graduated)
 *   - account present, complete=true                   → graduated (LP locked)
 */
export async function getPumpFunStatus(
  connection: Connection,
  mint: PublicKey,
): Promise<PumpFunStatus> {
  const account = await connection.getAccountInfo(bondingCurvePda(mint));
  if (!account || !account.owner.equals(PUMPFUN_PROGRAM_ID)) {
    return "not_pumpfun";
  }
  return parseBondingCurveComplete(account.data) ? "graduated" : "on_curve";
}
