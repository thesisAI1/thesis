/**
 * THE AUDITOR — on-chain forensics on the token.
 *
 * A strict gate model — a token must clear EVERY hard requirement:
 *   1. Launched via Clanker or Bankr. Those launchpads deploy a standard,
 *      audited token + LP, so contract-level honeypot / rug risk is removed —
 *      no separate honeypot check is needed.
 *   2. At least `minTokenAgeHours` old — avoids the instant pump-and-dumps.
 *   3. Top 10 *real* holders (excluding LP pools, burn addresses and locked
 *      positions) control no more than `maxTop10Pct` of supply.
 *   4. Market cap at least `minMarketCapUsd` — avoids micro-cap rugs.
 *   5. Market cap at most `maxMarketCapUsd` — avoids "discovered" tokens
 *      where the upside is already gone.
 *
 * Fail any gate -> Token Score 0 (the Dean will SKIP it). Pass every gate ->
 * a high score, refined by liquidity depth and how far below the holder cap
 * the token sits.
 */

import type { Submission, TokenReport } from "@thesis/shared";
import { createBaseDataAdapter } from "../adapters/basedata/index.js";
import { config } from "../config.js";

const TRUSTED_LAUNCHPADS = ["clanker", "bankr"];

/** Holder labels that don't count as real circulating supply for the
 *  concentration calc: LP pools, burns, locked liquidity. */
const NON_CIRCULATING = new Set(["lp", "burn", "lock"]);

export async function runAuditor(submission: Submission): Promise<TokenReport> {
  const token = await createBaseDataAdapter().getToken(submission.contractAddress);

  // Drop LP pools, burn addresses and locked positions before measuring the
  // real concentration of supply — otherwise every legitimate Uniswap token
  // looks "rugged" because its own pool is the #1 holder.
  const realHolders = token.topHolders.filter(
    (h) => !NON_CIRCULATING.has((h.label ?? "").toLowerCase()),
  );
  const excludedCount = token.topHolders.length - realHolders.length;
  const top10 = realHolders.slice(0, 10).reduce((sum, h) => sum + h.share, 0);
  const top10Pct = top10 * 100;
  const ageHours = (Date.now() - Date.parse(token.launchedAt)) / 3_600_000;
  const launchpad = (token.launchpad ?? "").toLowerCase();
  const fromTrustedLaunchpad = TRUSTED_LAUNCHPADS.includes(launchpad);

  const flags: string[] = [];
  const reasoning: string[] = ["Fetching on-chain data — launchpad, age, holders…"];

  // Gate 1 — launchpad origin.
  reasoning.push(
    fromTrustedLaunchpad
      ? `Launched via ${launchpad} — standard contract, no honeypot / rug risk`
      : `Launchpad: ${token.launchpad ?? "unknown"} — NOT Clanker or Bankr`,
  );
  // Gate 2 — token age.
  reasoning.push(
    ageHours >= config.auditor.minTokenAgeHours
      ? `Token age ${formatAge(ageHours)} — past the instant-dump window`
      : `Token age ${formatAge(ageHours)} — too new (under ${config.auditor.minTokenAgeHours}h)`,
  );
  // Gate 3 — real-holder concentration (excludes LP / burn / locked).
  reasoning.push(
    excludedCount > 0
      ? `Top 10 real holders control ${top10Pct.toFixed(0)}% of supply (excluded ${excludedCount} LP/burn/lock address${excludedCount === 1 ? "" : "es"})`
      : `Top 10 holders control ${top10Pct.toFixed(0)}% of supply`,
  );
  // Gates 4 & 5 — market cap band.
  const mcap = token.marketCapUsd;
  const minMcap = config.auditor.minMarketCapUsd;
  const maxMcap = config.auditor.maxMarketCapUsd;
  reasoning.push(
    mcap < minMcap
      ? `Market cap ${fmtUsd(mcap)} — below the ${fmtUsd(minMcap)} floor (too micro-cap)`
      : mcap > maxMcap
        ? `Market cap ${fmtUsd(mcap)} — above the ${fmtUsd(maxMcap)} ceiling (already discovered)`
        : `Market cap ${fmtUsd(mcap)} — inside the ${fmtUsd(minMcap)}–${fmtUsd(maxMcap)} band`,
  );

  let score: number;
  if (!fromTrustedLaunchpad) {
    flags.push("not launched via Clanker or Bankr");
    score = 0;
  } else if (ageHours < config.auditor.minTokenAgeHours) {
    flags.push(`launched under ${config.auditor.minTokenAgeHours}h ago`);
    score = 0;
  } else if (top10Pct > config.auditor.maxTop10Pct) {
    flags.push(`top 10 hold ${top10Pct.toFixed(0)}% — over the ${config.auditor.maxTop10Pct}% cap`);
    score = 0;
  } else if (mcap < minMcap) {
    flags.push(`market cap ${fmtUsd(mcap)} — under the ${fmtUsd(minMcap)} floor`);
    score = 0;
  } else if (mcap > maxMcap) {
    flags.push(`market cap ${fmtUsd(mcap)} — over the ${fmtUsd(maxMcap)} ceiling`);
    score = 0;
  } else {
    // Every gate cleared — grade the quality.
    score = 70;
    if (token.liquidityUsd >= 150_000) score += 15;
    else if (token.liquidityUsd >= 50_000) score += 8;
    const headroom = config.auditor.maxTop10Pct - top10Pct; // 0..cap
    score += Math.round((headroom / config.auditor.maxTop10Pct) * 15);
    score = Math.min(100, score);
  }

  reasoning.push(
    score === 0
      ? "Verdict — Token Score 0 / 100 (failed a hard requirement)"
      : `Verdict — Token Score ${score} / 100 (all gates cleared)`,
  );

  return {
    contractAddress: token.contractAddress,
    chain: token.chain,
    score,
    launchpad: token.launchpad,
    liquidityUsd: token.liquidityUsd,
    marketCapUsd: token.marketCapUsd,
    launchedAt: token.launchedAt,
    top10Concentration: top10,
    topHolders: token.topHolders,
    isHoneypot: token.isHoneypot,
    flags,
    reasoning,
  };
}

/** Compact age string: "42m", "5h", "3d". */
function formatAge(hours: number): string {
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Compact USD: "$120K", "$2.5M". */
function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}
