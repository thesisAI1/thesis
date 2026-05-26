# THESIS

> An autonomous AI committee that reads token theses on X, grades them,
> and trades on Base. Pays thesis authors 25% of every winning trade.

**Links:** [thesisonbase.com](https://thesisonbase.com) · [@thesisonbase on X](https://x.com/thesisonbase) · [$THESIS chart](https://dexscreener.com/base/0x36e807119529E44d6F36aD5CE24AeB87a4529ba3) · [trading wallet on BaseScan](https://basescan.org/address/0x44fC6203B22717568a86664dd520337D0F637A01)

THESIS is a small society of LLM agents — Registrar, Auditor, Dean, Bursar,
Monitor, and the Endowment — that watches the @thesisonbase mentions on X,
evaluates the token + author + thesis each submission proposes, and (if the
committee approves) buys the token on Base. Every winning trade splits four
ways: 25% to the thesis author, 25% buys back and burns $THESIS, 25% goes to
maintenance, 25% reinvests into the portfolio.

The canonical deployment lives at **[thesisonbase.com](https://thesisonbase.com)**
and trades from one wallet. The $THESIS token (Base) is
`0x36e807119529E44d6F36aD5CE24AeB87a4529ba3`. Every action — the agents'
reasoning, the verdicts, every buy and exit, every payout — is published on
the public dashboard and on the @thesisonbase X account.

This repo is the entire system: the agents, the chain adapter, the website,
the docs. It runs end-to-end in **mock mode for $0** on any laptop with Node
20+.

---

## How it works

Every mention of `@thesisonbase` containing a contract address flows through
six stages, each owned by an agent:

```
       X mention
           ↓
   ┌── Triage ───┐         followers, thesis length, dedup, cooldowns
           ↓
   ┌── Registrar ──┐       scores the AUTHOR
   ┌── Auditor ────┐       scores the TOKEN (gates: age, holders, mcap, deployer)
   ┌── Dean ───────┐       LLM verdict: grade A/B/C/D/F + BUY/SKIP
           ↓
   ┌── Bursar ─────┐       sizes the position, fires the swap on Base
           ↓
   ┌── Monitor ────┐       watches every open position every 15s
           ↓                 take-profit ladder + trailing stop-loss
   ┌── Endowment ──┐       on a profitable close, splits the realised profit
                            25 / 25 / 25 / 25 and posts the author payout
                            request on X
```

The take-profit ladder is `+100% → sell 50%`, `+200% → sell 25%`,
`+300% → sell 15%`, `+1000% → sell 10%`. The stop-loss trails 30% below the
highest tier the position has reached, so once TP1 hits the floor moves up
with each subsequent tier.

Swaps are routed through the [KyberSwap Aggregator](https://kyberswap.com),
which sources liquidity from Uniswap v2/v3/v4, Aerodrome, BaseSwap and the
rest of the Base DEX universe — no per-DEX wiring on our side.

---

## Repo layout

```
packages/
  shared/      Cross-package types (Position, Submission, TradeOrder, …)
  backend/     The agents, adapters, service loops, HTTP server
    src/
      agents/        Registrar, Auditor, Dean, Bursar, Monitor, Endowment
      adapters/      x/, chain/, basedata/, frontrun/  — each has mock + real
      pipeline/      The orchestration that runs a submission through review
      triage/        Step-1 filtering before the LLM is invoked
      monitor/       The TP / SL loop
      payout/        Handles author wallet replies & on-chain transfers
      server/        The HTTP server + dashboard API + SSE event stream
      util/          Logging, reply templates, seeded RNG for the mock
  website/     Static dashboard — the Faculty Room, the trade record, docs
```

Each adapter has a **mock** (no keys, no network, $0) and a **real**
implementation. `THESIS_MODE=mock` runs the whole system locally with seeded
fake data — perfect for trying it out without spending a cent.

---

## Quickstart (mock mode, $0)

```bash
npm install
npm run dev
# open http://localhost:4319
```

You'll see the dashboard, a stream of synthetic submissions being graded by
the committee, mock positions opening and closing, and the Endowment splitting
mock profits. Nothing touches a real chain or a real API.

The `npm run demo` command runs one full cycle in batch mode (no server) and
prints the trade record to stdout.

---

## Going live

Live mode requires a few API keys and a Base mainnet wallet with a small ETH
balance. Costs run ~$200/mo with the recommended Frontrun plan.

1. Copy `.env.example` to `.env` and fill in:
   - `THESIS_MODE=live`
   - `ANTHROPIC_API_KEY` — for the Dean (Claude Haiku 4.5)
   - `X_BEARER_TOKEN` + `X_API_KEY/SECRET/ACCESS_TOKEN/ACCESS_SECRET` — to
     read mentions and post replies (X Premium tier needed for OAuth 1.0a)
   - `X_AGENT_USER_ID` — the numeric id of your agent's X account
   - `BASE_RPC_URL` — any Base mainnet RPC (Alchemy free tier is plenty)
   - `BASE_CHAIN_ID=8453`
   - `TRADING_WALLET_PRIVATE_KEY` — a fresh wallet, ETH-funded, used ONLY
     for trading. Never reuse a personal wallet.
   - `THESIS_TOKEN_ADDRESS`, `TEAM_WALLET` — the splits target these
   - `BASESCAN_API_KEY` — used by the Auditor to detect Clanker launches
   - `FRONTRUN_API_KEY` — author intelligence (optional but recommended)
   - `LIVE_TRADING_ARMED=true` — the final safety gate; real swaps will not
     fire without this

2. `npm start` — the service starts polling X, reviewing submissions, and
   trading.

3. The dashboard, the X replies, every BaseScan link — everything is public
   from the first buy onward.

---

## Canonical deployment

Anyone can fork this repo and run their own committee — that is the point of
open source. But there is exactly **one** canonical THESIS:

- X: [@thesisonbase](https://x.com/thesisonbase)
- Dashboard: [thesisonbase.com](https://thesisonbase.com)
- Token: `0x36e807119529E44d6F36aD5CE24AeB87a4529ba3` (Base)
- Trading wallet: `0x44fC6203B22717568a86664dd520337D0F637A01` (Base)

Forks running their own deployment have no claim on $THESIS — the buyback
and burn only runs against this contract from this trading wallet. Be wary
of anyone claiming otherwise.

---

## Contributing

Issues and PRs welcome. Notable areas where a sharper take would help:

- Tighter prompt engineering for the Dean (currently Claude Haiku 4.5)
- Better author-intelligence signal (smart-followers, CA history)
- Cleaner stop-loss logic for tokens with thin liquidity at TP-time
- Additional gates in the Auditor (mev-pool checks, deployer reputation)
- Telegram / Farcaster / Lens adapters for cross-platform thesis submission

The codebase is small (≈ 4k lines TypeScript) and the architecture is meant
to be readable end-to-end in an afternoon. Start with
`packages/backend/src/pipeline/index.ts` — that's the heart of the review flow.

---

## Disclaimer

This software trades volatile cryptocurrency tokens autonomously. **It can
and will lose money.** Past trade performance is not indicative of future
results. Nothing in this repo or on thesisonbase.com is financial advice.

If you fork and run THESIS:
- Use a fresh wallet you can afford to lose entirely
- Start in mock mode, then move to Base Sepolia, then mainnet
- Keep `LIVE_TRADING_ARMED` blank until you have verified swaps end-to-end
- Be aware that LLMs make mistakes; the Dean has off days

If you tag the canonical @thesisonbase and the committee funds your thesis,
you accept the same risk: the token may go to zero and your author share
will be zero too. Submit theses you would actually trade yourself.

---

## License

[MIT](./LICENSE) — do what you want with this, no warranty.
