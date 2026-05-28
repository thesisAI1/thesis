/** Composes the X reply texts the agent posts on a buy and on each exit. */

function bscTx(hash: string): string {
  return `https://basescan.org/tx/${hash}`;
}

/** Format a USD market cap compactly: 120000 -> "$120K". */
function marketCap(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(usd >= 10_000_000 ? 0 : 1)}M`;
  if (usd >= 1_000) return `$${Math.round(usd / 1_000)}K`;
  return `$${Math.round(usd)}`;
}

/** The reply posted to the original thesis when the Bursar funds a trade. */
export function buyReplyText(o: {
  grade: string;
  amountEth: number;
  marketCapUsd: number;
  takeProfits: ReadonlyArray<{ gainPct: number }>;
  stopLossPct: number;
  txHash: string;
}): string {
  const ladder = o.takeProfits.map((t) => `+${t.gainPct}%`).join(" / ");
  return [
    `Reviewed & funded by the committee — Grade ${o.grade}.`,
    `Bought ${o.amountEth.toFixed(3)} ETH at ~${marketCap(o.marketCapUsd)} market cap.`,
    `Laddered take-profit at ${ladder}; stop-loss -${o.stopLossPct}%.`,
    bscTx(o.txHash),
  ].join("\n");
}

/** Categories of SKIP we surface back to the author on X. Anything outside
 *  these maps to `null` and we stay silent (avoids spamming on internal errors). */
export type SkipKind =
  | {
      kind: "low-grade";
      grade: string;
      minGrade: string;
      /** Specific Auditor gate failures (e.g. "market cap $5M — over the $3M
       *  ceiling", "not launched via Clanker or Bankr"). When present, the
       *  reply calls them out explicitly so the author knows the real reason. */
      auditorFlags?: string[];
    }
  | { kind: "cooldown"; minutesLeft: number }
  | { kind: "daily-limit"; limit: number };

/** The reply posted on the original thesis when the committee passed on it.
 *  Returns null for skip reasons we don't want to advertise (internal/system). */
export function skipReplyText(o: SkipKind): string | null {
  if (o.kind === "low-grade") {
    // If the Auditor flagged a specific hard requirement, call it out by name —
    // way more useful than "Grade D". Pick up to 2 flags to keep the reply tight.
    const auditFlags = (o.auditorFlags ?? []).slice(0, 2);
    if (auditFlags.length > 0) {
      const formatted = auditFlags.map((f) => `· ${f}`).join("\n");
      return [
        `Reviewed by the committee — Grade ${o.grade}.`,
        "The Auditor flagged a hard requirement:",
        formatted,
        "Token fundamentals would need to clear that gate for the committee to fund.",
      ].join("\n");
    }
    return [
      `Reviewed by the committee — Grade ${o.grade}.`,
      `Only ${o.minGrade} and above are funded right now, so the position was passed on.`,
      "Thanks for the thesis — tag the committee again any time.",
    ].join("\n");
  }
  if (o.kind === "cooldown") {
    return [
      "Reviewed and approved by the committee — but the cooldown between buys is still active.",
      `The next position can open in ~${o.minutesLeft} minute${o.minutesLeft === 1 ? "" : "s"}.`,
      "Bad timing, not bad thesis. Try the committee again later.",
    ].join("\n");
  }
  if (o.kind === "daily-limit") {
    return [
      "Reviewed and approved by the committee — but the daily buy limit is reached.",
      `Capped at ${o.limit} buys per day for risk control. Resets at midnight UTC.`,
      "Tag the committee again tomorrow.",
    ].join("\n");
  }
  return null;
}

/** Why a thesis didn't even make it past Step-1 triage. */
export type TriageRejectKind =
  | { kind: "author_cooldown"; hoursLeft: number }
  | { kind: "contract_dedup"; hoursLeft: number }
  | { kind: "thesis_too_short"; words: number; minWords: number };

/** Reply text for a mention that failed Step-1 triage. */
export function triageRejectReplyText(r: TriageRejectKind): string {
  const formatHours = (h: number): string => {
    if (h < 1) return `~${Math.max(1, Math.round(h * 60))} minutes`;
    return `~${h.toFixed(1)} hours`;
  };
  if (r.kind === "author_cooldown") {
    return [
      "Got your thesis, but the committee already reviewed a submission from you recently.",
      `Same-author cooldown clears in ${formatHours(r.hoursLeft)}. Re-tag the committee then.`,
      "The cooldown keeps the queue fair — one thesis per author at a time.",
    ].join("\n");
  }
  if (r.kind === "contract_dedup") {
    return [
      "That contract was already reviewed by the committee very recently — skipping to avoid a duplicate position.",
      `Re-eligible in ${formatHours(r.hoursLeft)}. Tag the committee again then if your read still holds.`,
    ].join("\n");
  }
  return [
    `Your thesis is too short — the committee needs at least ${r.minWords} real words of analysis (got ${r.words}).`,
    "Tell us what you see: holders, liquidity, narrative, why now. The Dean grades on substance, not enthusiasm.",
  ].join("\n");
}

/** Parse the free-form skippedReason string from the Bursar into a structured SkipKind. */
export function classifySkipReason(reason: string): SkipKind | null {
  const cooldown = /cooldown active \((\d+)m left\)/.exec(reason);
  if (cooldown) return { kind: "cooldown", minutesLeft: Number(cooldown[1]) };
  const dailyLimit = /daily buy limit reached \((\d+)\)/.exec(reason);
  if (dailyLimit) return { kind: "daily-limit", limit: Number(dailyLimit[1]) };
  return null;
}

/** The reply posted on each exit — a take-profit tier or the stop-loss. */
export function exitReplyText(
  o:
    | {
        kind: "tp";
        tier: number;
        gainPct: number;
        sellPct: number;
        proceedsEth: number;
        profitEth: number;
        final: boolean;
        txHash: string;
      }
    | { kind: "sl"; netPnlEth: number; tiersHit: number; txHash: string },
): string {
  if (o.kind === "sl") {
    const sign = o.netPnlEth >= 0 ? "+" : "";
    const result = `Net result on the position: ${sign}${o.netPnlEth.toFixed(4)} ETH.`;
    // Differentiate a pure loss (no tiers hit) from a partial-profit close where
    // some TPs already banked profit before the trailing stop closed the rest.
    if (o.tiersHit === 0) {
      return [
        "Stop-loss triggered — position closed at a loss.",
        "The price dropped 30% below entry before any take-profit tier fired.",
        result,
        "Better luck next time — sharper entries on the next thesis.",
        bscTx(o.txHash),
      ].join("\n");
    }
    return [
      `Trailing stop triggered after TP${o.tiersHit} — position fully closed.`,
      `${o.tiersHit} take-profit tier${o.tiersHit === 1 ? "" : "s"} banked profit before the trail stop took the remainder.`,
      result,
      "Thanks for the thesis — tag the committee again any time.",
      bscTx(o.txHash),
    ].join("\n");
  }

  // Per-tier text is intentionally claim-free about "profit". A partial TP
  // is just an on-chain swap — real settlement (author 25%, $THESIS burn,
  // etc.) only runs at full close, where the final-close text + card carry
  // the actual profit narrative. "Holding the rest" makes it obvious that
  // the position is still open.
  const lines = [`Take-profit TP${o.tier} hit at +${o.gainPct}%.`];
  if (o.final) {
    lines.push(`Sold the remaining ${o.sellPct}% — ${o.proceedsEth.toFixed(4)} ETH back.`);
    lines.push("Final tier — every rung of the ladder cleared, position closed.");
  } else {
    lines.push(`Sold ${o.sellPct}% — ${o.proceedsEth.toFixed(4)} ETH back. Holding the rest.`);
  }
  lines.push(bscTx(o.txHash));
  return lines.join("\n");
}

/**
 * The reply asking an unregistered author to send a payout wallet.
 *
 * It is posted in-thread on the author's own thesis. The author claims their
 * share by REPLYING to this tweet with a 0x address — and only a reply from
 * the original author's account is honoured, so the payout cannot be hijacked.
 */
export function payoutRequestText(o: { handle: string; amountEth: number }): string {
  return [
    `${o.handle} — your thesis closed in profit. Your 25% author share is ${o.amountEth.toFixed(4)} ETH.`,
    "Reply to THIS tweet with your Base wallet address (0x…) and the committee sends it on-chain.",
    "Only the account that posted the original thesis can claim it — any other reply is ignored.",
  ].join("\n");
}

/** The reply confirming an author payout was sent on-chain. */
export function payoutSentText(o: {
  handle: string;
  amountEth: number;
  wallet: string;
  txHash: string;
}): string {
  return [
    `${o.handle} — author share paid: ${o.amountEth.toFixed(4)} ETH sent to ${o.wallet}.`,
    "Thanks for the thesis. Tag the committee again any time.",
    bscTx(o.txHash),
  ].join("\n");
}
