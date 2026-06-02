/**
 * THESIS — Pitch your thesis.
 *
 * Recovered from the original static `pitch.html` (dropped when the redesign
 * replaced packages/website with this Next.js app) and rebuilt in the
 * Direction-B system: the two submission gates (the post and the token), how to
 * close your own position early, and a one-tap "tweet your thesis" CTA that
 * pre-loads the X composer with a thesis template.
 *
 * Static Server Component — the only interactive piece is the X intent link.
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TopBar } from "@/components/shell/TopBar";
import { Footer } from "@/components/shell/Footer";
import { Card } from "@/components/ui/Card";
import { SectionTag } from "@/components/ui/SectionTag";
import { XIcon } from "@/components/shell/icons";
import styles from "./pitch.module.css";

/**
 * The X account an author tags to submit — the project's published handle, and
 * the account whose mentions the agent polls. The backend selects that account
 * by numeric id (see .env.example), so this constant is the human-facing label
 * only; flip it here if the submission handle ever differs from the brand's.
 */
const AGENT_HANDLE = "@thesisonbase";

export const metadata: Metadata = {
  title: "THESIS — Pitch your thesis",
  description:
    "How to submit a thesis the committee will fund. Two simple gates — pass both and your read goes on-chain with the treasury behind it.",
};

/** Pre-loads X's composer with a thesis template the author fills in. */
const TWEET_TEMPLATE = `${AGENT_HANDLE}

$TICKER — short thesis here (narrative + what's catalyzing attention).

Onchain: holders, liquidity, buyer pattern.

Risk: what would invalidate it.

CA: 0x...`;
const TWEET_URL = `https://twitter.com/intent/tweet?text=${encodeURIComponent(TWEET_TEMPLATE)}`;

interface Rule {
  /** The requirement itself. */
  key: ReactNode;
  /** Why the committee enforces it. */
  why: ReactNode;
}

/** Gate 1 — the post. Vetted by the Registrar (the author). */
const POST_RULES: Rule[] = [
  {
    key: (
      <>
        Tag <code className={styles.code}>{AGENT_HANDLE}</code>
      </>
    ),
    why: "The agent only polls its own mentions. No tag, no review.",
  },
  {
    key: "Include the Base contract address",
    why: "A thesis without a CA is a chat, not a pitch. The Auditor needs the on-chain target to score it.",
  },
  {
    key: "At least 6 words of analysis",
    why: "Bare-CA drops are spam. The Dean grades substance, not enthusiasm.",
  },
  {
    key: "50+ X followers",
    why: "Filters sock-puppet accounts that mass-shill rugs. Soft threshold, silent skip.",
  },
  {
    key: "One thesis per 45 minutes",
    why: "Per-account cooldown so the queue stays fair when good dips appear.",
  },
  {
    key: "Same token only after 2 hours",
    why: "Stops duplicate-position spam. If your read still holds in 2h, re-tag.",
  },
];

/** Gate 2 — the token. Vetted by the Auditor (on-chain forensics). */
const TOKEN_RULES: Rule[] = [
  {
    key: "Launched on Clanker, Bankr or Virtuals",
    why: "Known launchpads with on-chain provenance and standard fee mechanics. Filters most rug templates by construction.",
  },
  {
    key: "Older than 1 hour",
    why: "Avoids snipe-and-dump windows. The first hour after launch is where most rugs happen.",
  },
  {
    key: "Market cap $40K – $3M",
    why: "Below $40K is too thin to trade safely. Above $3M is already discovered — limited asymmetric upside.",
  },
  {
    key: "Live on Base chain",
    why: "The treasury and KyberSwap routing live on Base. Other chains are out of scope.",
  },
  {
    key: "Liquidity holding, not draining",
    why: "If LP is bleeding, the entry is into a slow rug. The Auditor checks depth in real time.",
  },
];

/** After a buy — the author can take profit early by replying to their thesis. */
const CLOSE_RULES: Rule[] = [
  {
    key: (
      <>
        Reply to your thesis with <code className={styles.code}>{AGENT_HANDLE} close</code>
      </>
    ),
    why: (
      <>
        Natural phrasings all work: <code className={styles.code}>close</code> ·{" "}
        <code className={styles.code}>exit</code> · <code className={styles.code}>sell all</code> ·{" "}
        <code className={styles.code}>take profit</code> · <code className={styles.code}>tp now</code>{" "}
        · <code className={styles.code}>cash out</code>. The committee sells the remaining tokens
        immediately, runs the full 25/25/25/25 settlement, and posts the close card on the thread.
      </>
    ),
  },
  {
    key: "Requires the position to be ≥ +20% in net profit",
    why: "Below that the request is rejected with a short note. The stop-loss handles losing trades — manual close is for taking profit early when your conviction shifts, not for ducking the SL.",
  },
  {
    key: "Only the original author can close",
    why: "Anti-hijack: replies from other accounts are silently ignored. One close attempt per author per 60 seconds.",
  },
];

/** A gate's stacked requirement → reasoning rows. */
function RuleList({ rules }: { rules: Rule[] }) {
  return (
    <>
      {rules.map((rule, i) => (
        <div key={i} className={styles.rule}>
          <div className={styles.ruleKey}>{rule.key}</div>
          <div className={styles.ruleWhy}>{rule.why}</div>
        </div>
      ))}
    </>
  );
}

export default function PitchPage() {
  return (
    <>
      <TopBar />

      <main className="mx-auto max-w-shell px-7 pb-[90px]">
        {/* Hero */}
        <section className="pt-[42px]">
          <SectionTag>Pitch · Two gates · Zero cost</SectionTag>
          <h1 className="mt-[18px] mb-3 text-[clamp(34px,5vw,48px)] font-extrabold leading-[1.05] tracking-[-1.4px]">
            Pitch your thesis.
          </h1>
          <p className="max-w-[64ch] text-[17px] leading-[1.6] text-muted">
            Tag the committee on X with a Base contract and your take. Pass both gates below and the
            agents review, fund, and pay you{" "}
            <b className="font-semibold text-text">25% of every winning trade</b> — live, on-chain,
            on the record.
          </p>
        </section>

        {/* The two gates */}
        <div className="mt-[34px] grid grid-cols-1 gap-[18px] md:grid-cols-2">
          <Card className="px-[22px] py-[22px]">
            <span className={styles.kicker} style={{ color: "var(--blue)" }}>
              Gate 01 · The post
            </span>
            <h2 className={styles.gateTitle}>Why these post rules</h2>
            <RuleList rules={POST_RULES} />
          </Card>

          <Card className="px-[22px] py-[22px]">
            <span className={styles.kicker} style={{ color: "var(--accent)" }}>
              Gate 02 · The token
            </span>
            <h2 className={styles.gateTitle}>Why these token rules</h2>
            <RuleList rules={TOKEN_RULES} />
          </Card>
        </div>

        {/* Close your own position early */}
        <Card className="mt-[18px] px-[22px] py-[22px]">
          <span className={styles.kicker} style={{ color: "var(--green)" }}>
            After the buy · Optional
          </span>
          <h2 className={styles.gateTitle}>Close your own position early</h2>
          <RuleList rules={CLOSE_RULES} />
        </Card>

        {/* Tweet-your-thesis CTA */}
        <Card highlight className="mt-[26px] px-8 py-[42px] text-center">
          <h2 className="text-[clamp(26px,3.4vw,34px)] font-extrabold leading-[1.08] tracking-[-0.8px]">
            Ready to pitch?
          </h2>
          <p className="mx-auto mb-[26px] mt-3 max-w-[52ch] text-[15.5px] leading-[1.6] text-muted">
            Open X with a thesis template pre-loaded. Replace the placeholders with your real read,
            drop the contract address, hit post.
          </p>
          <a className={styles.tweetBtn} href={TWEET_URL} target="_blank" rel="noopener noreferrer">
            <XIcon width={15} height={15} />
            Tweet your thesis
          </a>
          <p className="mt-[22px] font-mono text-[11.5px] tracking-[0.4px] text-dim">
            The Dean grades on substance — narrative, on-chain signals, risk awareness.
          </p>
        </Card>
      </main>

      <Footer />
    </>
  );
}
