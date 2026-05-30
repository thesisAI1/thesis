/**
 * Scripted demo reviews — replayed in the Faculty Room when the live SSE stream
 * is idle, so the section is never dead. Ported from the mockup's QUEUE; each
 * entry feeds the same reduction the real stream drives via emitted events.
 */
import type { Decision, Grade } from "@/lib/api";
import type { StreamEvent } from "@/lib/useEventStream";

export interface DemoReview {
  author: string;
  thesis: string;
  ca: string;
  token: string;
  registrar: string[];
  auditor: string[];
  dean: string[];
  grade: Grade;
  decision: Decision;
  size: number;
}

export const DEMO_REVIEWS: DemoReview[] = [
  {
    author: "@onchainmaxi",
    thesis:
      "Clanker launch with a real product shipping weekly. Founder doxxed, LP locked 12mo, holders climbing organically. This is the Base infra play.",
    ca: "0x9c2f…a41b",
    token: "$FORGE",
    registrar: [
      "Account age 2.3y · 14.2k followers",
      "Smart-follower reach: 38 known callers",
      "No sybil signal · 6 prior calls, 4 green",
      "Author score 81 / 100",
    ],
    auditor: [
      "Clanker launch · LP locked 12mo",
      "Top-10 holders 21% · 1,840 holders",
      "No honeypot · sells unblocked",
      "Liquidity $182K · token score 77 / 100",
    ],
    dean: [
      "Weighing author 81 + token 77",
      "Thesis specific, falsifiable, on-trend",
      "Risk acceptable at 8% sizing",
    ],
    grade: "A",
    decision: "BUY",
    size: 8.0,
  },
  {
    author: "@basedanon",
    thesis:
      "Meme with a cult following but the deployer holds 9% across three linked wallets. Chart looks primed though.",
    ca: "0x4ad1…77ce",
    token: "$MOCHI",
    registrar: [
      "Account age 0.7y · 5.1k followers",
      "Reach thin · 4 known callers",
      "1 prior call, rugged",
      "Author score 44 / 100",
    ],
    auditor: [
      "Bankr launch · LP locked",
      "Deployer + 2 linked wallets hold 9%",
      "Clustered insider holding flagged",
      "Token score 51 / 100",
    ],
    dean: [
      "Author 44 + token 51 — below bar",
      "Insider clustering is the deal-breaker",
      "Verdict: pass on this one",
    ],
    grade: "D",
    decision: "SKIP",
    size: 0,
  },
  {
    author: "@degenscholar",
    thesis:
      "Aerodrome-adjacent yield router, audited, 3.2k holders and the team ships on a public roadmap. Slow burn, not a pump.",
    ca: "0x7e09…1f2a",
    token: "$ROUTE",
    registrar: [
      "Account age 3.1y · 22.7k followers",
      "Reach strong · 61 known callers",
      "9 prior calls, 6 green",
      "Author score 88 / 100",
    ],
    auditor: [
      "Verified contract · audit on file",
      "Top-10 holders 17% · 3,210 holders",
      "Liquidity $340K · sells clean",
      "Token score 82 / 100",
    ],
    dean: [
      "Author 88 + token 82 — strong",
      "Thesis is durable, not momentum",
      "Size toward the top of the range",
    ],
    grade: "A",
    decision: "BUY",
    size: 9.4,
  },
];

/** A scheduled event = a delay (ms from review start) and the event to emit. */
export interface ScheduledEvent {
  at: number;
  event: StreamEvent;
}

/**
 * Expand one demo review into the same event sequence the live pipeline would
 * publish, with mockup-matched timing. The Faculty Room replays these through
 * its reducer so the demo and the real stream share one code path.
 */
export function demoEvents(review: DemoReview): ScheduledEvent[] {
  const out: ScheduledEvent[] = [];
  const STEP = 450;

  out.push({
    at: 0,
    event: {
      type: "review:start",
      submission: {
        authorHandle: review.author,
        thesisText: review.thesis,
        contractAddress: review.ca,
        postUrl: null,
      },
    },
  });

  // Registrar + Auditor run in parallel.
  out.push({ at: 400, event: { type: "agent:active", agent: "registrar" } });
  out.push({ at: 400, event: { type: "agent:active", agent: "auditor" } });
  review.registrar.forEach((text, i) =>
    out.push({ at: 700 + i * STEP, event: { type: "agent:step", agent: "registrar", text } }),
  );
  review.auditor.forEach((text, i) =>
    out.push({ at: 850 + i * STEP, event: { type: "agent:step", agent: "auditor", text } }),
  );
  out.push({ at: 2700, event: { type: "agent:done", agent: "registrar" } });
  out.push({ at: 2700, event: { type: "agent:done", agent: "auditor" } });

  // Dean.
  out.push({ at: 3000, event: { type: "agent:active", agent: "dean" } });
  review.dean.forEach((text, i) =>
    out.push({ at: 3300 + i * 480, event: { type: "agent:step", agent: "dean", text } }),
  );
  out.push({
    at: 4900,
    event: {
      type: "review:verdict",
      grade: review.grade,
      decision: review.decision,
      positionSizePct: review.size / 100,
    },
  });
  out.push({ at: 4900, event: { type: "agent:done", agent: "dean" } });

  // Bursar.
  const buy = review.decision === "BUY";
  const bursarLines = buy
    ? [
        `Verdict BUY · sizing ${review.size.toFixed(1)}% of portfolio`,
        "Swap routed via KyberSwap on Base",
        `Filled ${review.token} · TP +100/+200/+300/+1000`,
        `Replied to ${review.author} on X ↗`,
      ]
    : [
        "Verdict SKIP · nothing to fund",
        "Only A and B grades open a position",
        "Logged to the public decision record",
      ];
  out.push({ at: 5300, event: { type: "agent:active", agent: "bursar" } });
  bursarLines.forEach((text, i) =>
    out.push({ at: 5600 + i * 460, event: { type: "agent:step", agent: "bursar", text } }),
  );
  out.push({ at: buy ? 7700 : 7200, event: { type: "agent:done", agent: "bursar" } });
  out.push({ at: buy ? 7900 : 7400, event: { type: "review:end" } });

  return out;
}
