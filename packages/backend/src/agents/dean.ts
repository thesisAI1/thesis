/**
 * THE DEAN — the final verdict.
 *
 * Reads the author's thesis, weighs the Registrar and Auditor reports, and
 * delivers a grade (A-F) plus a BUY / SKIP decision, a position size, and a
 * reasoning trail.
 *
 * In live mode the judgement is made by the LLM (Anthropic API). If no key is
 * set, or the call fails, it falls back to a transparent rule-based verdict.
 */

import type {
  AuthorReport,
  Grade,
  Submission,
  TokenReport,
  Verdict,
} from "@thesis/shared";
import { config } from "../config.js";

export async function runDean(
  submission: Submission,
  authorReport: AuthorReport,
  tokenReport: TokenReport,
): Promise<Verdict> {
  const reasoning: string[] = [];
  const combined = (authorReport.score + tokenReport.score) / 2;

  reasoning.push(`Reading the thesis submitted by ${submission.authorHandle}…`);
  reasoning.push(
    `Weighing the Registrar (${authorReport.score}) against the Auditor (${tokenReport.score})`,
  );

  const llm = await llmVerdict(submission, authorReport, tokenReport);
  reasoning.push(
    llm
      ? "Consulted the LLM for a judgement call on the thesis itself"
      : "Scored against the rule book (no LLM key set)",
  );

  const grade = llm ? llm.grade : toGrade(combined);
  const decision: Verdict["decision"] = meetsBuyThreshold(grade, config.trading.minBuyGrade)
    ? "BUY"
    : "SKIP";
  const confidence = llm ? llm.confidence : combined / 100;

  const { positionSizeMinPct, positionSizeMaxPct } = config.trading;
  const positionSizePct =
    decision === "BUY"
      ? lerp(positionSizeMinPct, positionSizeMaxPct, combined / 100) / 100
      : 0;

  const rationale =
    llm?.rationale ??
    `Rule-based verdict. Combined score ${combined.toFixed(0)}/100 -> grade ${grade}.`;

  reasoning.push(rationale);
  reasoning.push(
    decision === "BUY"
      ? `Verdict — Grade ${grade}, FUND IT at ${(positionSizePct * 100).toFixed(1)}% of portfolio`
      : `Verdict — Grade ${grade}, SKIP (minimum buy grade: ${config.trading.minBuyGrade})`,
  );

  return {
    submission,
    authorReport,
    tokenReport,
    grade,
    decision,
    confidence,
    positionSizePct,
    rationale,
    reasoning,
  };
}

interface LlmVerdict {
  grade: Grade;
  confidence: number;
  rationale: string;
}

/** Ask Anthropic to grade the submission. Returns null if unavailable. */
async function llmVerdict(
  submission: Submission,
  author: AuthorReport,
  token: TokenReport,
): Promise<LlmVerdict | null> {
  if (!config.llm.anthropicKey) return null;

  const prompt = [
    'You are "The Dean", the final reviewer of a token thesis. Weigh the',
    "author's credibility, the on-chain token report, and the thesis text.",
    "Default to scepticism, but the project is in launch phase: most callers",
    "are new accounts with little Frontrun history yet. Do not discredit a",
    "submission for low author score alone — weight the thesis substance and",
    "the token report more heavily. A thoughtful thesis on a healthy token",
    "from an unknown caller can still merit an A or B grade.",
    "",
    'IMPORTANT context — "Clanker" and "Bankr" are the names of trusted',
    "token launchpads on Base. They are proper nouns, not English words —",
    '"Bankr" is NOT short for "bankrupt". A token launched via either uses',
    "a standard, audited contract and LP setup, so contract-level honeypot",
    "or rug risk is already mitigated. Treat the launchpad identity as a",
    "positive signal, not a negative one.",
    "",
    "Reply with ONLY a JSON object:",
    '{"grade":"A|B|C|D|F","confidence":0.0-1.0,"rationale":"one sentence"}',
    "",
    `THESIS: ${submission.thesisText}`,
    `AUTHOR: score ${author.score}/100, likely bot ${author.isLikelyBot}, ` +
      `smart followers ${author.smartFollowerCount}, past hit-rate ` +
      `${(author.pastHitRate * 100).toFixed(0)}%, flags: ${flags(author.flags)}`,
    `TOKEN: score ${token.score}/100, liquidity $${token.liquidityUsd}, ` +
      `honeypot ${token.isHoneypot}, launchpad ${token.launchpad ?? "unknown"}, ` +
      `flags: ${flags(token.flags)}`,
  ].join("\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.llm.anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.llm.model,
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { content?: Array<{ text?: string }> };
    const text = json.content?.[0]?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as {
      grade?: string;
      confidence?: number;
      rationale?: string;
    };
    return {
      grade: toGrade(gradeToScore(parsed.grade)),
      confidence: clamp01(Number(parsed.confidence ?? 0.5)),
      rationale: String(parsed.rationale ?? "LLM verdict."),
    };
  } catch {
    return null;
  }
}

function flags(list: string[]): string {
  return list.length ? list.join("; ") : "none";
}

/** Strict grade ordering — A is best, F is worst. */
const GRADE_RANK: Record<Grade, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };

/** Does `grade` meet the configured minimum BUY threshold? */
function meetsBuyThreshold(grade: Grade, min: string): boolean {
  const minRank = GRADE_RANK[min as Grade] ?? 4; // unknown env value -> default to B
  return GRADE_RANK[grade] >= minRank;
}

function toGrade(score: number): Grade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

/** Map a letter grade back to a representative score (for normalisation). */
function gradeToScore(grade: string | undefined): number {
  switch ((grade ?? "").toUpperCase()) {
    case "A":
      return 90;
    case "B":
      return 75;
    case "C":
      return 60;
    case "D":
      return 45;
    default:
      return 20;
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

/** Linear interpolation, clamped to [0, 1] on t. */
function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * Math.max(0, Math.min(1, t));
}
