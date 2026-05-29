/**
 * THE HARD GATE — deterministic BUY authorization, downstream of the LLM.
 *
 * Architecture: "the LLM proposes, deterministic rules dispose." The Dean (and
 * its LLM) may PROPOSE a grade, but this pure function has the final say on
 * whether real ETH is spent on an EXTERNAL submission. It calls no LLM and
 * touches no network, so an attacker-controlled thesis cannot talk it out of a
 * veto. Note the two deliberate exemptions below (the $THESIS self-token, and —
 * elsewhere — the operator's gated /admin spend endpoints): "non-bypassable"
 * applies to the normal external-submission path, not to those.
 *
 * Policy (STRICT VETO): the Auditor reports score 0 whenever a token fails ANY
 * of its hard gates — wrong launchpad, too new, over-concentrated holders, or
 * market cap out of band (see agents/auditor.ts; liquidity is a bonus, not a
 * gate). A score-0 token is one the Auditor already REJECTED, so we never buy
 * it, regardless of the grade. As an extra, independent veto this function also
 * blocks any token flagged isHoneypot — the Auditor folds honeypot risk into
 * the launchpad gate, so this is belt-and-suspenders, not the Auditor's check.
 * The committee's own $THESIS token is exempt — its auto-A buyback is a
 * deliberate, audited reactive buy.
 */

import type { TokenReport } from "@thesis/shared";
import { config } from "../config.js";

/** Result of the buy gate. `reason` is always populated (an explanation on
 *  denial, a note on allow) and surfaced in the agent stream / skip reason. */
export interface GateResult {
  allowed: boolean;
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

  // STRICT VETO: only a strictly-positive score may buy. Written as `!(score > 0)`
  // rather than `score <= 0` so a NaN score (e.g. from a malformed data feed)
  // is also vetoed — `NaN <= 0` is false and would have let it through.
  if (!(tokenReport.score > 0)) {
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
