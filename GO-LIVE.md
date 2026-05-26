# THESIS — Go-Live Runbook

This is the step-by-step plan to take the **backend live**. It is split into
stages that go from **zero financial risk** to **fully armed**, so nothing real
is ever at stake before it has been proven on the stage before it.

> **Two phases.** This document is **Phase 1 — the tech goes live**: the agent
> reviews real submissions on X, on real Base data, and trades real funds.
> **Phase 2 — the $THESIS token launch** comes after, and is only sketched at
> the end (§9).

---

## The master safety gate

Before anything else, know this: real on-chain buys and sells **never fire**
unless the environment variable `LIVE_TRADING_ARMED` is exactly `true`. Every
stage below keeps it **off** until the final step. You can run the entire
system — polling, reviews, verdicts, X replies — with real money completely
untouched.

---

## 1. What it costs

| Item | Model | Rough cost |
|---|---|---|
| **X API** | Pay-per-use (2026 model): ~$0.01 per post written, ~$0.005 per post read, 2M reads/mo cap, **no monthly minimum** | Low to start (~$10–50/mo), scales with mention volume |
| **Frontrun API** | Paid plan (author intelligence) | ~$200/mo — confirm at docs.frontrun.pro |
| **Anthropic API** | Pay-as-you-go (the Dean, Claude Haiku) | Tens of $/mo at our review budget |
| **Base RPC** | Alchemy / QuickNode | Free tier is enough to start; ~$0–50/mo later |
| **BaseScan API** | Free tier | $0 |
| **DexScreener / GoPlus** | Public, free | $0 |
| **VPS hosting** | Small always-on server | ~$5–20/mo |
| **Trading capital** | ETH you fund the trading wallet with | Your choice — start small |
| **Gas** | Base transaction fees | Cents per trade |

**Recurring infrastructure** realistically lands around **$220–320/mo** early
on, plus Anthropic usage, plus whatever capital you choose to trade with.

---

## 2. Procure the accounts & keys

Work through this checklist. Each item ends with the `.env` variable it fills.

- [ ] **X developer app.** Sign in at developer.x.com **as `@thesis_agent`**
      and create a Project + App. New developers are on the pay-per-use model
      automatically.
  - [ ] Set **App permissions: Read and Write** (Write is required to post replies).
  - [ ] Generate **Bearer Token** → `X_BEARER_TOKEN`
  - [ ] Generate **API Key + Secret** → `X_API_KEY`, `X_API_SECRET`
  - [ ] Generate **Access Token + Secret** *after* setting Read+Write → `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`
  - [ ] Get the **numeric user id** of `@thesis_agent` → `X_AGENT_USER_ID`
- [ ] **Set the X "Automated" label.** On `@thesis_agent`: Settings → Your
      account → Automation → mark it automated, managing account = your main
      account. This is X compliance and lowers the suspension risk.
- [ ] **Frontrun paid plan** → `FRONTRUN_API_KEY`
- [ ] **Anthropic API key** (console.anthropic.com) → `ANTHROPIC_API_KEY`
- [ ] **BaseScan API key** (free, basescan.org) → `BASESCAN_API_KEY`
- [ ] **RPC provider** (Alchemy or QuickNode). Create **two** endpoints:
      a Base **Sepolia** URL (for §5) and a Base **mainnet** URL (for §6+).
- [ ] **Two fresh wallets** — generate brand-new private keys, never reuse a
      personal wallet:
  - [ ] A **testnet wallet** for Base Sepolia (§5).
  - [ ] The **mainnet trading wallet** (§6+) → `TRADING_WALLET_PRIVATE_KEY`
- [ ] A **team wallet** address (receives 25% of wins) → `TEAM_WALLET`

---

## 3. Hosting (always-on)

The backend must run 24/7 — not on your laptop.

- [ ] Provision a small **VPS** (any provider), Ubuntu, **Node.js 20+**.
- [ ] Clone the repo, run `npm install`, then `npm run typecheck` to confirm it builds.
- [ ] Run under a **process manager** (pm2 or systemd) so it restarts on crash
      and on reboot. Provide the environment variables through the process
      manager (pm2 ecosystem file / systemd `EnvironmentFile=`).
- [ ] Point a **domain** at the server and put **HTTPS** in front (Caddy or
      nginx as a reverse proxy to the backend `PORT`). The website and the
      `/docs` page are served by the backend.

---

## 4. Configure `.env`

Copy `.env.example` to `.env` and fill it in. First smoke-test on the server
with `THESIS_MODE=mock` — confirm the site loads and the Faculty Room runs.
Then move through the stages below.

---

## 5. Stage 1 — Testnet dry run (Base Sepolia)

**Risk: zero.** Only test ETH is ever spent.

- [ ] `.env`: `THESIS_MODE=live`, `BASE_RPC_URL=<your Sepolia URL>`,
      `BASE_CHAIN_ID=84532`, `TRADING_WALLET_PRIVATE_KEY=<testnet wallet>`,
      `LIVE_TRADING_ARMED=true` (on Sepolia, "armed" only spends test ETH).
- [ ] Fund the testnet wallet from a **Base Sepolia faucet** (free).
- [ ] Start the backend and validate, end to end:
  - [ ] Real mentions of `@thesis_agent` are polled.
  - [ ] The agent can **post a reply** on X.
  - [ ] The **Registrar** gets data from Frontrun. **If the Frontrun response
        shape differs from what the adapter expects, the adapter needs a small
        code adjustment — flag it and we fix it.**
  - [ ] The **Dean** LLM call returns a verdict.
  - [ ] A **buy swap** executes on Sepolia, and a **sell** executes.
  - [ ] The **monitor** fires a take-profit / stop-loss exit.
  - [ ] A **payout** `sendEth` goes through.

> **Honest caveat.** Base Sepolia has little or no real Clanker/Bankr token
> data, so the Auditor's launchpad gate may reject everything on testnet.
> Stage 1 proves the **X + wallet + swap + LLM plumbing**. The Auditor's
> launchpad detection and token-data path are only truly validated on mainnet
> in Stage 2.

---

## 6. Stage 2 — Mainnet, trading DISARMED

**Risk: zero.** Real X, real data, but no swap can fire.

- [ ] `.env`: `BASE_RPC_URL=<your mainnet URL>`, `BASE_CHAIN_ID=8453`,
      `TRADING_WALLET_PRIVATE_KEY=<real trading wallet>`, and leave
      **`LIVE_TRADING_ARMED` unset/blank**.
- [ ] Keep `THESIS_MODE=live`.
- [ ] Restart and watch for a few days. The agent now reviews **real**
      submissions on **real mainnet token data** and posts **real** verdicts
      and replies — but executes **no swaps** (the gate is off).
  - [ ] Are the Auditor gates detecting Clanker / Bankr correctly?
  - [ ] Are the grades and rationales sane?
  - [ ] Does the triage funnel look healthy on the dashboard?

This is the real-world test of the committee's **judgement** — with zero
financial risk.

---

## 7. Stage 3 — Arm trading, small

- [ ] Fund the mainnet **trading wallet** with a **small** amount of ETH to
      start. Position size is a percentage of the wallet balance, so a small
      wallet automatically means small trades.
- [ ] Optional extra caution for the first days — in `.env`, lower
      `MAX_BUYS_PER_DAY` and `POSITION_SIZE_MAX_PCT`.
- [ ] Set `LIVE_TRADING_ARMED=true` and restart.
- [ ] Watch the **first real trade** end to end: the buy, the monitor, the
      first take-profit exit, and the first real author payout on X.
- [ ] When it has run clean, raise the limits / capital gradually.

---

## 8. Run & monitor (ongoing)

- [ ] **Back up the data directory** (`DATA_DIR`). The file store holds escrow,
      positions and the wallet registry — if the box is lost, you lose the
      record of who you owe. Snapshot the volume regularly; move to the
      Postgres store before scaling.
- [ ] Watch the logs for repeated `X` / `Frontrun` failures (rate limits,
      shadowban, suspension).
- [ ] **Recommended hardening before scaling** (optional but advised): proper
      retry/backoff that honours `Retry-After`, a per-adapter circuit breaker,
      a "degraded" status on the dashboard, and an alert when X or Frontrun
      goes down. Currently failures are logged but silent.

---

## 9. Phase 2 — Token launch (later)

Deferred. In short: launch **$THESIS** on Base via Clanker or Bankr; set
`THESIS_TOKEN_ADDRESS` in `.env` (this activates the buyback-and-burn leg of
the Endowment); route the launchpad creator fees to the trading wallet; and
add DexScreener socials for the token. We will plan this separately.

---

## Appendix — `.env` quick reference

| Variable | Stage | Notes |
|---|---|---|
| `THESIS_MODE` | all | `mock` = free/no calls; `live` = real adapters |
| `LIVE_TRADING_ARMED` | 3 | The master gate. Real swaps fire **only** on `true` |
| `X_BEARER_TOKEN` | 1 | App-only read (mentions) |
| `X_AGENT_USER_ID` | 1 | Numeric id of `@thesis_agent` |
| `X_API_KEY` / `X_API_SECRET` | 1 | OAuth 1.0a consumer keys |
| `X_ACCESS_TOKEN` / `X_ACCESS_SECRET` | 1 | OAuth 1.0a — generate with Read+Write |
| `FRONTRUN_API_KEY` | 1 | The Registrar's author intelligence |
| `ANTHROPIC_API_KEY` | 1 | The Dean's LLM verdict |
| `BASESCAN_API_KEY` | 1 | Clanker deployer lookup (free) |
| `BASE_RPC_URL` | 1 / 2 | Sepolia URL for §5, mainnet URL for §6+ |
| `BASE_CHAIN_ID` | 1 / 2 | `84532` Sepolia · `8453` mainnet |
| `TRADING_WALLET_PRIVATE_KEY` | 1 / 3 | Fresh key — never a personal wallet |
| `TEAM_WALLET` | 1 | Receives 25% of winning trades |
| `THESIS_TOKEN_ADDRESS` | Phase 2 | Blank until launch; enables buyback & burn |
| `PORT` / `PUBLIC_BASE_URL` | 3 | The HTTP server / website |
| `DATA_DIR` | all | The file store — back this up |
