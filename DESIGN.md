# THESIS — Design Document

**Status:** Phases 1–4 complete — the full system runs locally in mock mode.
Phase 5 (go-live) is pending API keys. · **Last updated:** 2026-05-25

> An AI agent committee that reviews token "theses" posted on X / Twitter and
> trades on the Base chain. This document is the single source of truth for how
> the system is meant to work. It will be edited as the build progresses.

---

## 1. Concept

A user on X tags the agent account, writes a short **thesis** explaining why
they like a particular Base-chain token, and pastes the token's contract
address. That post is a *submission*.

A committee of five AI agents — collectively **The Faculty** — reviews every
submission. They check who the author is, examine the token on-chain, weigh the
thesis itself, and decide whether to buy. If they buy and the trade wins, the
profit is split four ways — including a 25% cut paid back to the author who
submitted the idea.

The whole thing is funded by a token, **$THESIS**, launched on Base. Trading
fees from that token top up the agent's trading wallet, and a quarter of every
winning trade is used to buy $THESIS back and burn it.

The brand runs on an academic metaphor: users *submit a thesis*, the Faculty
*reviews* it, and it receives a *grade* (A–F). Only A and B submissions get
funded.

---

## 2. The Faculty — the five agents

| Agent | Role | Output |
|---|---|---|
| **The Registrar** | Vets the *author*: account age, bot / sybil detection, smart-follower reach, and past-call track record. | Author Score (0–100) |
| **The Auditor** | On-chain forensics on the *token*: holder distribution, launchpad origin, liquidity, honeypot / rug checks. | Token Score (0–100) |
| **The Dean** | Reads the *thesis text*, weighs the Registrar and Auditor reports, delivers the verdict. | Grade A–F + BUY / SKIP |
| **The Bursar** | Executes the trade: position sizing (5–10%), entry on Base, take-profit / stop-loss, anti-spam rate limit. | An open Position |
| **The Endowment** | The treasury: the 25/25/25/25 profit split, author payouts, and the $THESIS buyback-and-burn. | A Distribution |

Each agent is a module under `packages/backend/src/agents/`. They communicate
only through the typed objects defined in `packages/shared/src/index.ts`, so any
agent can be rewritten without touching the others.

---

## 3. The submission pipeline

```
X mentions ─► poll  ─►  Step 1 triage filters   (free — no API calls)
                        contract? · followers? · real thesis? ·
                        contract dedup · per-author cooldown
                            │
                            ▼
                        Review queue  — budget ~30/hour, by priority, 40-min TTL
                            │
                            ▼
        Submission ─►  ┌── The Registrar ──► Author Score
                       │   (Frontrun + Base data)
                       ├── The Auditor ────► Token Score
                       │   (Base data)
                       ▼
                   The Dean ──► Grade A–F + BUY / SKIP
                       │
                  (if BUY)
                       ▼
                   The Bursar ──► opens a Position, sets TP/SL, replies on X
                       │
                  (TP or SL hit)
                       ▼
                   The Endowment ──► splits 25/25/25/25 on-chain, replies on X
```

**Mention selection (triage).** A tagged account could be spammed with
hundreds of mentions. The service does not review them all. It polls every
5 minutes, then applies free **Step 1 filters** — drop posts with no contract,
authors below a follower threshold, posts with no real thesis text, contracts
or authors already seen recently. Survivors enter a **review queue**, drained
by a **review loop** at a budget (~30/hour) in priority order (author reach +
engagement); stale queue items expire after 40 minutes. Only then does a
submission reach the agents. See `triage/` and `service.ts`.

The Registrar and Auditor run **in parallel**. The Dean waits for both. When
the Bursar funds a trade it **replies to the original X post** (grade, amount,
entry market cap, TP/SL, BaseScan link); the monitor replies again when the
position closes. Exits are handled out-of-band by the monitor, which hands
closed positions to the Endowment.

The orchestration lives in `packages/backend/src/pipeline/index.ts`
(`reviewSubmission` and `settlePosition`).

---

## 4. Data sources & the adapter pattern

Every external service the system depends on sits behind an **adapter** — an
interface with two implementations:

- a **mock** implementation: fake but realistic data, no network, no key, $0;
- a **real** implementation: the actual paid / live service.

A single environment variable, `THESIS_MODE`, selects which one is used. In
`mock` mode the entire pipeline runs locally for free; in `live` mode the real
adapters are used. **No application code changes between the two** — only
`.env`. This is what makes "build now, pay later" possible: ~95% of the system
can be written and tested before a single dollar is spent.

The four adapters (`packages/backend/src/adapters/`):

| Adapter | Live source | Notes |
|---|---|---|
| `frontrun` | Frontrun paid API (~$200/mo) | Author intelligence: CA history, smart followers, rename history, linked wallets. |
| `x` | X / Twitter API (pay-as-you-go) | Mention monitoring + author timelines. Rate limits matter as much as cost. |
| `basedata` | DexScreener / GeckoTerminal / Birdeye | Token holders, liquidity, launchpad, rug checks. Free tiers exist — can be built first. |
| `chain` | Base chain via viem | The Bursar's wallet and swaps. Develop on Base Sepolia testnet (free). |

### A note on Frontrun and Base

Frontrun's paid API returns an X account's **CA history** — the contract
addresses that account has posted. That list is derived from parsing tweets, so
it captures Base contracts the same as any other. What the API does **not**
return is the *performance* of those tokens. So the Registrar works in two
steps: get the CA list from Frontrun, then check each Base contract's
performance via the `basedata` adapter. Confirm with Frontrun
(`https://t.me/frontrunintern`) whether CA history is chain-tagged and what the
rate limits are.

---

## 5. Trading logic

**Position sizing.** Each buy uses 5–10% of the trading portfolio. The exact
percentage scales with the Dean's combined score — a stronger verdict sizes
toward 10%, a weaker one toward 5%. Configurable via
`POSITION_SIZE_MIN_PCT` / `POSITION_SIZE_MAX_PCT`.

**Take-profit / stop-loss.** Every position gets a TP and SL level attached at
entry (defaults: +100% / −35%, configurable). A monitoring loop polls price and
closes the position when either level is hit. A future refinement is laddered
take-profits (sell portions at 2×, 3×, …) and a trailing stop.

**Anti-spam rate limit.** To stop a wave of mentions from draining the
portfolio, the Bursar enforces a maximum number of buys per day
(`MAX_BUYS_PER_DAY`) and a cooldown between buys (`BUY_COOLDOWN_MINUTES`).

**MEV protection.** Once the trading wallet is known publicly, its swaps can be
front-run and dumped on. Live trading should route through an MEV-protected
RPC.

---

## 6. Tokenomics & the 25/25/25/25 fee flow

**The token.** $THESIS is launched on Base via a launchpad (Clanker / Bankr).
Using a launchpad keeps the launch cheap and provides the fee mechanism out of
the box: the launchpad pays the creator a share of LP / trading fees, which
streams into the trading portfolio.

**Funding the portfolio.** Two inflows top up the trading wallet: the Clanker
creator fees, and the portfolio's own 25% share of winning trades (below).

**The profit split.** When the Bursar closes a position in profit, the
Endowment splits the realised profit four ways:

- **25% → Author.** Paid to the X user whose submission triggered the trade.
- **25% → Portfolio.** Compounded back into the trading wallet.
- **25% → Team.** A team / maintenance wallet that covers running costs.
- **25% → Buyback & Burn.** Buys $THESIS on the open market and burns it,
  reducing supply.

A losing trade has no profit to split; the stop-loss limits the damage and only
the trading portfolio absorbs the loss.

---

## 7. The author payout mechanism

The author's 25% is handled **entirely on X** — there is no website
registration, no login, and no wallet-connect. The thread under the author's
own thesis is the trusted channel.

When the Endowment settles a winning trade it looks up the author's numeric X
id (never the `@handle` — handles are mutable; the id is stable):

- **Known wallet.** If the author has a wallet on file (from a previous
  payout), the 25% is sent straight to it and the agent posts a reply with the
  transaction link.
- **No wallet yet.** The share is held in **escrow** and the agent replies to
  the author's thesis stating the amount owed and asking them to reply with a
  Base wallet address. One open request per author; further wins simply grow
  the escrow.

**Claiming — and why it cannot be hijacked.** The author claims by *replying*
to that request tweet with a `0x` address. The poll loop honours a wallet
reply only when **both** hold:

1. it is a reply to the *exact* payout-request tweet the agent posted, and
2. it comes from the *exact numeric X user id* that posted the original thesis.

A reply from anyone else — even with an identical `@handle` — is ignored. When
a valid reply arrives the escrow is paid out in full, the wallet is recorded
for next time, and the agent confirms with a transaction-link reply.

---

## 8. Tech stack & repo structure

**TypeScript** end to end — backend and (later) frontend. Reasoning: the best
Base / EVM tooling (viem, wagmi) is in TypeScript, and a single language across
the stack keeps the project maintainable.

```
thesis/
├── package.json            npm workspaces root
├── tsconfig.base.json      shared TS config
├── .env.example            all configuration, documented
├── DESIGN.md               this document
├── docs/
│   └── architecture.svg    system diagram
└── packages/
    ├── shared/             domain types (the contract between agents)
    ├── backend/
    │   └── src/
    │       ├── config.ts       env-driven configuration
    │       ├── store/          persistence (file-backed local / Postgres prod)
    │       ├── adapters/       frontrun · x · basedata · chain  (mock + real)
    │       ├── triage/         Step 1 mention filters
    │       ├── agents/         registrar · auditor · dean · bursar · endowment
    │       ├── pipeline/       review orchestration
    │       ├── monitor/        take-profit / stop-loss watcher
    │       ├── payout/         author wallet-reply payout handler
    │       ├── events.ts       live event bus (SSE)
    │       ├── server/         HTTP server + transparency API
    │       ├── service.ts      poll · triage · review · monitor loops
    │       ├── util/           contracts, replies, oauth1, logging
    │       └── index.ts        entry point
    └── website/            live transparency dashboard (static)
```

Planned dependencies, added as the real adapters are built: `viem` (chain),
`@anthropic-ai/sdk` (the Dean), and a Postgres client (registry + position
store). Until then the scaffold needs only `typescript`, `tsx` and
`@types/node`.

---

## 9. Build phases

1. **Scaffold + design** — *done*. Repo structure, domain model, this document,
   the architecture diagram.
2. **Backend core** — *done*. Agent scoring logic, the pipeline, and the
   file-backed store (registry, positions, rate-limit log, escrow).
3. **Real adapters** — *done*. DexScreener + GoPlus `basedata`, the X API v2
   client, the Frontrun client, the viem `chain` adapter, and the Anthropic
   call for the Dean. All gated so they activate only when keys are present;
   live swaps are additionally gated behind `LIVE_TRADING_ARMED`.
4. **Website + service** — *done*. The poll / monitor service loops, the
   on-X author payout flow, the HTTP server, and the live transparency
   dashboard.
5. **Go-live** — *pending*. Fill in `.env` (Frontrun, X API, Anthropic, mainnet
   RPC, trading wallet), validate swaps on Base Sepolia, launch $THESIS, set
   `THESIS_MODE=live`.

Everything through Phase 4 costs **$0** and runs locally today. Money is needed
only at Phase 5.

### Remaining work before go-live

- Confirm the Frontrun API endpoint shape and update `adapters/frontrun/real.ts`.
- Validate the Uniswap-v3 swap path in `adapters/chain/real.ts` on Base Sepolia
  testnet. The swaps and treasury transfers run a pre-flight `simulateContract`
  call (no gas), but a funded testnet wallet is still needed to confirm live
  execution end to end.
- Refine the Registrar / Auditor scoring models with real data.
- Replace the file-backed store with Postgres for production.

The Endowment's on-chain execution — paying the author and team, and the
$THESIS buyback &amp; burn — is implemented and gated behind `LIVE_TRADING_ARMED`.

---

## 10. Costs

**Monthly running cost (lean):** roughly **$330–460/month** — Frontrun API
(~$200), X API pay-as-you-go (~$100–200), a small VPS (~$10–20), the Anthropic
API for the Dean (~$20–40), a domain (~$1). Base data APIs, RPC, database and
web hosting all start on free tiers.

**One-off launch cost:** roughly **$320–350** — token launch gas via Clanker
(~$20–50) and the DexScreener Enhanced Token Info / socials (~$300). No custom
smart-contract audit is needed at MVP, because the 25/25/25/25 split and the
buyback are done by backend code, not by on-chain contracts. An audit
($5k–30k+) becomes necessary only if funds are later moved into custom
contracts.

**Capital (at risk, not an expense):** the trading portfolio (the user's
choice — a few hundred dollars to start, more to make trades meaningful) and,
if the team chooses to, a $THESIS supply position.

---

## 11. Risks & open questions

These are real and should be understood before Phase 5. None of this is legal
or financial advice.

**Adversarial selection.** A bot that buys tokens random people show it is
being fed adversarially-chosen tokens — many submitters will tag the agent
specifically to make it exit liquidity for their own bags. The Registrar and
Auditor scoring is the defence and must be strict: penalise authors who post
their own deployments, require minimum liquidity and token age, keep position
sizes small.

**Regulatory.** A token with profit distribution, a revenue share and
buyback-and-burn may be treated as a security in some jurisdictions. This needs
a crypto lawyer's review before launch.

**Key security.** The trading wallet holds real funds on a server. It needs
careful key management (e.g. a KMS, restricted access, separation from the
codebase).

**Detectability of an insider $THESIS position.** If the team accumulates
$THESIS supply through side wallets, on-chain analysts — and the project's own
Auditor logic — will flag it as clustered insider holding. Weigh the
reputational cost against the benefit.

**Open questions to resolve.**
- Frontrun API: is CA history chain-tagged, and what are the rate limits?
- X API: what monitoring throughput does the pay-as-you-go budget actually buy?
- Launchpad: confirm Clanker's creator-fee mechanics and how fees are claimed.
- Payout: should an unclaimed escrow expire, and after how long?
