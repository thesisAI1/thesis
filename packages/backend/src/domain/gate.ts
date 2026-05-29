/**
 * THE HARD GATE — deterministic, non-bypassable BUY authorization.
 *
 * Architecture: "the LLM proposes, deterministic rules dispose." The Dean (and
 * its LLM) may PROPOSE a grade, but this pure function has the final say on
 * whether real ETH is spent. It calls no LLM and touches no network, so an
 * attacker-controlled thesis cannot talk it out of a veto.
 *
 * Policy (STRICT VETO): the Auditor reports score 0 whenever a token fails ANY
 * hard gate — honeypot, too new, thin liquidity, over-concentrated holders,
 * market cap out of band, or no market data at all (see agents/auditor.ts).
 * A score-0 token is one the Auditor already REJECTED, so we never buy it,
 * regardless of the grade. The committee's own $THESIS token is exempt — its
 * auto-A buyback is a deliberate, audited reactive buy.
 */

import type { TokenReport } from "@thesis/shared";
import { config } from "../config.js";

export interface GateResult {
  allowed: boolean;
  /** Human-readable explanation — surfaced in the agent stream and skip reason. */
  reason: string;
}

/**
 * Decide whether a BUY may proceed for `contractAddress`, given the Auditor's
 * token report. Pure and side-effect free — safe to call from the Dean (to set
 * the verdict) and again from the Bursar (as the final pre-spend check).
 */
export function evaluateBuyGate(
  contractAddress: string,
  tokenReport: TokenReport,
): GateResult {
  // Self-token exemption: the committee's own $THESIS buyback bypasses the gate
  // by design (it is the audited reactive buyback, not an external submission).
  const selfToken = config.chain.thesisToken;
  if (
    selfToken &&
    contractAddress.toLowerCase() === selfToken.toLowerCase()
  ) {
    return { allowed: true, reason: "self-token ($THESIS) buyback — exempt from the gate" };
  }

  // STRICT VETO: score 0 means the Auditor failed a hard gate. No grade overrides this.
  if (tokenReport.score <= 0) {
    const why = tokenReport.flags.length ? `: ${tokenReport.flags.join(", ")}` : "";
    return {
      allowed: false,
      reason: `Auditor rejected this token (score ${tokenReport.score}${why}) — hard gate, no buy`,
    };
  }

  // Belt-and-suspenders: a honeypot is an absolute veto even if scoring changes later.
  if (tokenReport.isHoneypot) {
    return { allowed: false, reason: "token flagged as a honeypot — absolute veto" };
  }

  return { allowed: true, reason: "passed the Auditor hard gate" };
}
