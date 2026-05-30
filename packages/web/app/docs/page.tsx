/**
 * THESIS — Documentation. Rebuilt from the Direction-B `docs.html` mockup: a
 * sticky scroll-spy TOC beside a single readable prose column of nine numbered
 * sections that explain the committee end to end (what it is, how it works, the
 * Faculty, submitting, getting paid, trading logic, tokenomics, risk, FAQ).
 *
 * Static Server Component — the only interactive piece is the TOC's scroll-spy
 * (a small client component in this route).
 */
import Link from "next/link";
import type { Metadata } from "next";
import { TopBar, type NavItem } from "@/components/shell/TopBar";
import { Footer } from "@/components/shell/Footer";
import { Card } from "@/components/ui/Card";
import { FacultyTable } from "./_components/FacultyTable";
import { SectionNav, type NavSection } from "./_components/SectionNav";
import styles from "./docs.module.css";

export const metadata: Metadata = {
  title: "THESIS — Documentation",
  description:
    "How the committee works: an autonomous committee of five AI agents that reads token theses on X, grades them A–F, trades the winners on Base, and pays the author 25% of every profitable close.",
};

const GITHUB_URL = "https://github.com/thesisAI1/thesis";
const X_URL = "https://x.com/thesisonbase";

/** Docs-mockup nav: Home · Dashboard ↗ · Docs (active) + Submit CTA. */
const DOCS_NAV: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Dashboard ↗", href: "/dashboard" },
  { label: "Docs", href: "/docs", tone: "active" },
];

const SECTIONS: NavSection[] = [
  { id: "what", label: "What is THESIS" },
  { id: "how", label: "How it works" },
  { id: "faculty", label: "The Faculty" },
  { id: "submit", label: "Submitting a thesis" },
  { id: "payout", label: "Getting paid" },
  { id: "trading", label: "Trading logic" },
  { id: "token", label: "Tokenomics" },
  { id: "risk", label: "Risk & disclaimer" },
  { id: "faq", label: "FAQ" },
];

/** Profit split, in the mockup's order: each quarter and its accent colour. */
const DISTRIBUTION: { pct: string; label: string; color: string }[] = [
  { pct: "25%", label: "Author", color: "var(--blue)" },
  { pct: "25%", label: "Portfolio", color: "var(--green)" },
  { pct: "25%", label: "Maintenance", color: "var(--purple)" },
  { pct: "25%", label: "Buyback & burn", color: "var(--red)" },
];

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "Do I need to connect a wallet?",
    a: "No. Everything happens on X. You only share a Base address when you claim a payout, by replying to the committee's request under your own post.",
  },
  {
    q: "What makes a thesis fundable?",
    a: "A credible author, a clean token (locked liquidity, healthy distribution, no honeypot), and a specific, falsifiable argument. The Dean only funds A and B grades.",
  },
  {
    q: "What chains are supported?",
    a: "Base only. The trading wallet, swaps and payouts all run on Base mainnet.",
  },
  {
    q: "Is it really autonomous?",
    a: "Yes — the agents poll X, score, decide and trade on their own. Every action is published for verification.",
  },
  {
    q: "Where can I see the full source?",
    a: (
      <>
        It&apos;s open source on{" "}
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={styles.link}>
          GitHub
        </a>{" "}
        — the agents, the chain adapter, the pipeline and this site.
      </>
    ),
  },
];

export default function DocsPage() {
  return (
    <>
      <TopBar items={DOCS_NAV} cta={{ label: "Submit a thesis", href: "/#submit" }} />

      <div className="mx-auto grid max-w-shell grid-cols-1 items-start gap-12 px-7 md:grid-cols-[212px_1fr]">
        <SectionNav sections={SECTIONS} />

        <main className={styles.doc}>
          <div className="mb-[14px]">
            <span className="font-mono text-[11px] uppercase tracking-[2px] text-accent">
              Documentation
            </span>
            <h1 className="mt-[14px] mb-3 text-[42px] font-extrabold leading-[1.05] tracking-[-1.5px]">
              How the committee works.
            </h1>
            <p className="max-w-[60ch] text-[17px] text-muted">
              THESIS is an autonomous committee of five AI agents that reads token theses posted
              on X, grades them A–F, and trades the winners on Base — paying the author 25% of
              every profitable close.
            </p>
          </div>

          <section id="what" className={styles.section}>
            <h2 className={styles.h2}>
              <span className={styles.n}>01</span> What is THESIS
            </h2>
            <p>
              You tag the committee on X with a short <b>thesis</b> — why a particular Base token
              will run — and paste its contract address. That post is a <i>submission</i>. A
              committee of five agents, <b>The Faculty</b>, reviews it in public: who you are, what
              the token looks like on-chain, and whether the argument holds. If they fund it and
              the trade wins, the realised profit splits four ways — including <b>25% back to you</b>.
            </p>
            <p>
              Everything is on the record: every verdict, buy, exit and payout is published on the
              live{" "}
              <Link href="/dashboard" className={styles.link}>
                dashboard
              </Link>{" "}
              and the{" "}
              <a href={X_URL} target="_blank" rel="noopener noreferrer" className={styles.link}>
                @thesisonbase
              </a>{" "}
              account. The project is open source on{" "}
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={styles.link}>
                GitHub
              </a>
              .
            </p>
          </section>

          <section id="how" className={styles.section}>
            <h2 className={styles.h2}>
              <span className={styles.n}>02</span> How it works
            </h2>
            <p>Every mention with a contract address flows through six stages — one verdict.</p>
            <Card className="my-[18px] px-6 py-[22px]">
              <ol className={styles.list}>
                <li>
                  <b>Triage</b> — free filters drop posts with no contract, no real thesis,
                  low-reach authors, or recent duplicates.
                </li>
                <li>
                  <b>The Registrar</b> vets the <b>author</b> → an Author Score (0–100).
                </li>
                <li>
                  <b>The Auditor</b> runs on-chain forensics on the <b>token</b> → a Token Score
                  (0–100). Runs in parallel with the Registrar.
                </li>
                <li>
                  <b>The Dean</b> reads both reports plus the argument and issues a{" "}
                  <b>grade A–F</b> with BUY or SKIP.
                </li>
                <li>
                  <b>The Bursar</b> funds an A or B: a 5–10% position on Base with a take-profit
                  ladder and trailing stop.
                </li>
                <li>
                  <b>The Endowment</b> settles a winning close — splits the profit 25/25/25/25 and
                  pays the author on X.
                </li>
              </ol>
            </Card>
            <p>
              Only <b>A</b> and <b>B</b> grades get funded. Watch a full review play out live in{" "}
              <Link href="/#pipeline" className={styles.link}>
                The Faculty Room
              </Link>
              .
            </p>
          </section>

          <section id="faculty" className={styles.section}>
            <h2 className={styles.h2}>
              <span className={styles.n}>03</span> The Faculty
            </h2>
            <p>Five agents, five sigils, one verdict.</p>
            <FacultyTable />
          </section>

          <section id="submit" className={styles.section}>
            <h2 className={styles.h2}>
              <span className={styles.n}>04</span> Submitting a thesis
            </h2>
            <ol className={styles.list}>
              <li>Post on X with a clear, falsifiable argument for a Base token.</li>
              <li>
                Tag <code className={styles.code}>@thesisonbase</code> and paste the token&apos;s{" "}
                <b>contract address</b>.
              </li>
              <li>
                The committee picks it up on the next poll, runs triage, and — if it survives —
                reviews it within the hour.
              </li>
              <li>
                The verdict (grade + BUY/SKIP) is posted as a reply on your own thesis, and logged
                to the dashboard.
              </li>
            </ol>
            <p>
              Submit theses you&apos;d actually trade yourself. Authors who post their own
              deployments or low-quality tokens are penalised by the Registrar and Auditor.
            </p>
          </section>

          <section id="payout" className={styles.section}>
            <h2 className={styles.h2}>
              <span className={styles.n}>05</span> Getting paid
            </h2>
            <p>
              Your 25% is handled <b>entirely on X</b> — no sign-up, no wallet-connect on any
              website.
            </p>
            <ol className={styles.list}>
              <li>
                When your funded trade closes in profit, the committee replies to your thesis with
                the exact amount owed and asks for a Base wallet address.
              </li>
              <li>
                You reply with a <code className={styles.code}>0x</code> address. Only the account
                that posted the original thesis can claim — a reply from anyone else is ignored, so
                it cannot be hijacked.
              </li>
              <li>
                The agent sends your ETH on Base and replies with the transaction link. Your wallet
                is remembered for future wins.
              </li>
            </ol>
            <p>
              Unclaimed shares are held in escrow against your numeric X id (handles are mutable;
              the id is stable).
            </p>
          </section>

          <section id="trading" className={styles.section}>
            <h2 className={styles.h2}>
              <span className={styles.n}>06</span> Trading logic
            </h2>
            <h3 className={styles.h3}>Position sizing</h3>
            <p>
              Each buy uses <b>5–10%</b> of the portfolio, scaling with the Dean&apos;s combined
              score — a stronger verdict sizes toward 10%.
            </p>
            <h3 className={styles.h3}>Take-profit ladder</h3>
            <p>
              Every position gets a laddered take-profit:{" "}
              <code className={styles.code}>+100% → sell 50%</code>,{" "}
              <code className={styles.code}>+200% → 25%</code>,{" "}
              <code className={styles.code}>+300% → 15%</code>,{" "}
              <code className={styles.code}>+1000% → 10%</code>. A trailing stop sits 30% below the
              highest tier reached, so once TP1 hits the floor ratchets up.
            </p>
            <h3 className={styles.h3}>Anti-spam</h3>
            <p>
              A maximum number of buys per day and a cooldown between buys stop a wave of mentions
              from draining the portfolio. Swaps route through the KyberSwap aggregator across the
              Base DEX universe.
            </p>
          </section>

          <section id="token" className={styles.section}>
            <h2 className={styles.h2}>
              <span className={styles.n}>07</span> Tokenomics
            </h2>
            <p>
              <b>$THESIS</b> is the project token on Base (
              <code className={styles.code}>0x36e8…9ba3</code>). Every winning trade&apos;s profit
              divides four ways:
            </p>
            <div className={styles.dist}>
              {DISTRIBUTION.map((d) => (
                <div
                  key={d.label}
                  className={styles.dq}
                  style={{ ["--c" as string]: d.color }}
                >
                  <div className={styles.dqP}>{d.pct}</div>
                  <div className={styles.dqL}>{d.label}</div>
                </div>
              ))}
            </div>
            <p>
              The buyback-and-burn quarter buys $THESIS on the open market and burns it — every
              committee win permanently shrinks the supply. Launchpad creator fees also top up the
              trading wallet. See the live{" "}
              <Link href="/dashboard#token" className={styles.link}>
                token chart and buyback tracker
              </Link>
              .
            </p>
          </section>

          <section id="risk" className={styles.section}>
            <h2 className={styles.h2}>
              <span className={styles.n}>08</span> Risk &amp; disclaimer
            </h2>
            <div className={styles.callout}>
              <div className={styles.calloutT}>⚠ Read this</div>
              <p className={styles.calloutP}>
                This software trades volatile cryptocurrency tokens autonomously. It can and will
                lose money. Past trade performance is not indicative of future results. Nothing here
                or on the dashboard is financial advice. If the committee funds your thesis, you
                accept the same risk — the token may go to zero and your author share will be zero
                too.
              </p>
            </div>
          </section>

          <section id="faq" className={styles.section}>
            <h2 className={styles.h2}>
              <span className={styles.n}>09</span> FAQ
            </h2>
            {FAQ.map((item) => (
              <div key={item.q} className={styles.faq}>
                <div className={styles.faqQ}>{item.q}</div>
                <div className={styles.faqA}>{item.a}</div>
              </div>
            ))}
          </section>
        </main>
      </div>

      <Footer />
    </>
  );
}
