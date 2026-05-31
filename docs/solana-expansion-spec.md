# Solana Expansion — Spec (rebased on staging)

Goal: THESIS **adds** Solana coin coverage **alongside** Base (not a switch). The
committee identifies the chain from the submission, audits the Solana token
(pump.fun only), buys the correct token on Solana, monitors it, and splits the
profit — while every existing Base behavior stays byte-for-byte identical.

Branch: `feat/solana-support`, based off reconciled `staging`
(hardening + dashboard merge, 103/103 tests green).

## Locked decisions

1. **Additive, not a switch.** Base path unchanged. Solana is a parallel path
   selected per submission. Proof obligation: the 103-test suite stays green at
   every wave.
2. **Denomination** — reuse existing `*Eth` fields as *native gas-token units
   scoped to the position's chain*. A Solana position's `entryPriceEth`,
   `amountInEth`, `realisedPnlEth`, `toAuthorEth` … are **SOL**. No type renames,
   no website churn.
3. **Solana launchpad gate = pump.fun ONLY** (Base stays Clanker/Bankr).
   Launchpad trust becomes per-chain via `util/launchpad.ts`.
4. **Solana profit split** — 25 author (SOL) / 25 team (SOL) / 25 portfolio /
   **25 → dedicated `SOLANA_BUYBACK_WALLET`** (new env). No $THESIS burn on
   Solana, no holder lottery on Solana. **Base wins unchanged** (buyback+burn).
5. **Scope** — full Solana support in **mock mode** ($0, testable) + the **real
   Jupiter / @solana/web3.js swap path scaffolded behind `LIVE_TRADING_ARMED`**.

## Completeness pass — full Base-coupled surface (verified on staging)

Beyond the agents, these surfaces are hardcoded to Base/ETH and MUST be made
chain-aware or a Solana win posts wrong info / pays the wrong chain:

- **Author payout** (`payout/index.ts`): uses viem `isAddress` + `/\b0x..40\b/`
  + arg-less `createChainAdapter().sendEth()`. Needs base58 extraction +
  validation and a chain-correct send. `PayoutRequest`/escrow must carry chain.
- **Registry** (`store` + `RegistryEntry`): one wallet per X id today; an author
  can win on BOTH chains → wallet must be per (xUserId, chain). Touches
  `store-migration.test.ts`.
- **X replies** (`util/replies.ts`): `bscTx` → BaseScan only; "X ETH"; "Base
  wallet (0x…)". Make native-symbol + explorer chain-aware.
- **Profit card** (`cards/profit-card.ts`): hardcodes "ETH" and "25% buyback &
  burn" (no burn on Solana). [SCOPE: see decision below.]
- **Activity / announcement strings**: `monitor/index.ts` (`Ξ` summaries),
  `pipeline/index.ts` ("Buying X ETH … on Base"), `server/index.ts` close
  announcement ("Base wallet", BaseScan tx links).
- **Admin/manual endpoints** (`server/index.ts`, ~7 call sites): test-swap buy,
  force-close, manual close, dashboard pricing — each must use `pos.order.chain`.
- **Factory call-site inventory (~18)**: author-actions(2), monitor(3),
  endowment(3 incl. author sendEth), auditor(1), bursar(1), server(7),
  payout(1). `chain/real.ts` internal basedata use stays Base.
- **Lottery** (`holders/index.ts`): GoldRush + Etherscan 8453 + Clanker factory
  list — Base-only. Solana skips the lottery even when globally enabled.
- **config-validation**: new Solana block must not break `config-validation.test.ts`;
  validate Solana wallet/RPC only when Solana live-trading is configured.

## Current-code anchors (post-hardening — verified on staging)

- **Deterministic veto already exists:** `domain/gate.ts → evaluateBuyGate(address, tokenReport)`
  is called by Dean AND Bursar. Chain-agnostic: vetoes `score 0` / honeypot /
  NaN; exempts the self `$THESIS`. ⇒ Solana Auditor just emits `score: 0` for a
  non-pump.fun token and the existing gate blocks the buy. **Do not duplicate it.**
- **Chain adapter factory:** `createChainAdapter()` is arg-less today, with a
  `__setChainForTest` override. New signature: `createChainAdapter(chain: Chain = "base")`
  — default keeps all existing sites/tests working; thread explicit `chain` at
  Bursar/Monitor/Endowment. Preserve `_testOverride` / `__setChainForTest`.
- **Token-data factory:** `createBaseDataAdapter()` → `createBaseDataAdapter(chain: Chain = "base")`.
- **Test runner:** `node --import tsx --test packages/backend/test/*.test.ts`
  (`node:test` + `node:assert/strict`). First import MUST be
  `./helpers/isolate-store.js`. RED-first is the house style (see `hard-gate.test.ts`).
- **Types:** `Chain` already includes `solana`. `Position.settlement?: SettlementProgress`
  (`teamDone`/`buybackDone`) — reuse for the Solana split; `buybackDone` covers
  the substitute-wallet transfer on Solana.

## Chain-identity flow (correctness-critical)

```
tweet → extractContract()   EVM 0x…40  OR  Solana base58 mint (32–44, [1-9A-HJ-NP-Za-km-z])
      → guessChain()        0x→base, base58→solana    (preliminary)
      → Auditor/basedata     DexScreener chainId = AUTHORITATIVE chain
      → TokenReport.chain    authoritative (overrides guess)
      → Verdict → TradeOrder.chain
      → Bursar  createChainAdapter(order.chain).buy()   ← right token, right chain
      → Position.order.chain → Monitor (price+sell per chain) → Endowment (split per chain)
```

## Work waves (each: RED test → GREEN impl → suite stays green → checkpoint commit)

### Wave 1 — Pure foundation
- `util/contracts.ts`: `extractContract` also matches Solana base58 mints;
  `guessChain` returns `solana` for base58 (EVM still `base`); preserve mock prefix.
- `util/launchpad.ts` (new): `trustedLaunchpads(chain)` + `isLaunchpadTrusted(chain, lp)`
  — base `{clanker,bankr}`, solana `{pumpfun}`.
- `util/chains.ts` (new): `isEvm`, `nativeSymbol` (ETH/SOL), `explorerTxUrl`,
  `explorerAddrUrl` (BaseScan vs Solscan).
- Tests: `contracts-solana.test.ts`, `launchpad-trust.test.ts`, `chains-util.test.ts`.

### Wave 2 — Config + deps
- `config.ts`: `solana` block — `SOLANA_RPC_URL`, `SOLANA_TRADING_WALLET_KEY`
  (base58), `SOLANA_BUYBACK_WALLET`, `JUPITER_API_BASE`, `SOLANA_SLIPPAGE_PCT`,
  SOL mint `So111…112`. Validation only fires for Solana in live mode (keep
  `config-validation.test.ts` green). `.env.example` + README go-live.
- deps: `@solana/web3.js`, `bs58` (+ `@solana/spl-token`).

### Wave 3 — Chain adapter
- `adapters/chain/index.ts`: `createChainAdapter(chain="base")` dispatch (EVM →
  existing Mock/Real; solana → new). Keep `__setChainForTest`.
- `adapters/chain/solana.mock.ts`: `MockSolanaChain` — seeded, base58 mock txids.
- `adapters/chain/solana.real.ts`: `RealSolanaChain` — Jupiter v6 quote+swap,
  web3.js Connection/Keypair, versioned-tx sign/send, `getBalance`,
  `SystemProgram.transfer` for `sendEth`(=sendSol). `buybackAndBurn` → no-op/throw
  (Endowment routes Solana's leg to the substitute wallet). `LIVE_TRADING_ARMED` gate.
  **Decimals: SOL = 9 (lamports), SPL mint decimals fetched per token** — the
  adapter normalizes so `priceEth` (=SOL/token) and `amountOut` stay consistent
  with the rest of the pipeline.
- Tests: `solana-chain-mock.test.ts` (+ Jupiter parse helper test, mirroring `tier-b-kyber-parse`).

### Wave 4 — Token data
- `adapters/basedata/index.ts`: `createBaseDataAdapter(chain="base")`.
- Generalize DexScreener by chain (`base`|`solana`); Solana holders+honeypot via
  GoPlus `/solana`; Birdeye already Solana-capable. pump.fun detection: mint
  `pump` suffix + DexScreener `dexId` (`pumpfun`/`pumpswap`/raydium graduate)
  → launchpad `"pumpfun"`. Comment the heuristic limitation (like Clanker's).
- Tests: solana token snapshot + launchpad detection.

### Wave 5 — Trading agents adapted (Base behavior preserved)
- **Auditor**: launchpad gate via `isLaunchpadTrusted(token.chain, launchpad)`
  (pump.fun for Solana); `TokenReport.chain` authoritative; reasoning names the
  chain. Non-pump.fun Solana ⇒ score 0 ⇒ existing `evaluateBuyGate` vetoes.
- **Dean**: prompt/reasoning name the chain ("Solana via pump.fun"). Self-token
  exemption stays Base-only.
- **Bursar**: `createChainAdapter(verdict.tokenReport.chain)`, size off that
  chain's wallet, `order.chain` = resolved chain.
- **Monitor**: group open positions by `order.chain`; one batched price call per
  chain; `sell` via `createChainAdapter(pos.order.chain)`.
- **Server admin/manual endpoints** (~7 sites): thread `pos.order.chain` into
  test-swap buy, force-close, manual close, dashboard pricing/symbol.
- Tests: auditor pump.fun gate, bursar buys-on-resolved-chain, monitor per-chain grouping.

### Wave 6 — Endowment split (per chain)
- `createChainAdapter(position.order.chain)`; pure `planDistribution(chain, profit)`
  (unit-tested) — Base = author/team/portfolio/buyback+burn (unchanged); Solana =
  author/team(SOL) + portfolio + 25% → `SOLANA_BUYBACK_WALLET` via `sendEth`,
  **no burn, no holder lottery** (lottery skipped for Solana even when globally
  enabled). Reuse `settlement` progress (`buybackDone` = substitute-transfer done).
- Tests: `endowment-solana-split.test.ts` (split routing + lottery-skip on Solana).

### Wave 7 — Author payout + registry (per chain)
- `payout/index.ts`: chain-aware wallet extraction (base58 for Solana, 0x for
  Base) + validation (drop hard viem `isAddress` dependence for Solana); send via
  `createChainAdapter(req.chain).sendEth`. `PayoutRequest` + escrow carry `chain`.
- `store` + `RegistryEntry`: payout wallet keyed per (xUserId, chain); migration
  keeps old single-wallet entries valid (default to base). Keep
  `store-migration.test.ts` + `payout-antihijack.test.ts` green.
- Tests: `payout-solana.test.ts` (base58 accept, EVM-on-solana reject, per-chain
  registry, chain-correct send), anti-hijack still holds.

### Wave 8 — X-facing output (replies, card, announcements)
- `util/replies.ts`: native symbol (SOL/ETH) + explorer (Solscan/BaseScan) per
  chain via `util/chains.ts`; payout-request asks for the right wallet kind.
- `cards/profit-card.ts`: native symbol; Solana shows substitute-wallet leg, not
  "buyback & burn". (IN SCOPE — it posts to X independently of the website.)
- Activity/announcement strings in `monitor`/`pipeline`/`server`: native symbol;
  drop hardcoded "on Base".
- Tests: reply-text chain-awareness (symbol + explorer host).

### Wave 9 — Mock feed + API exposure (UI DEFERRED)
- `adapters/x/mock.ts`: emit some Solana submissions (base58 mints ending `pump`,
  Solana-flavoured theses) so the funnel shows mixed-chain flow in mock. (backend)
- `server/index.ts`: ensure `order.chain` is present in the positions/trade-record
  API payloads so the new website can branch links/denomination. (backend, additive)
- **DEFERRED — no `packages/website/` edits.** A new website is being built;
  the front-end affordances (chain badge, SOL/ETH native-unit labels, Solscan vs
  BaseScan links, Solana split copy) are captured OUTSIDE the repo at
  `~/Desktop/thesis-solana-ui-notes.md`. `util/chains.ts` (Wave 1) provides the
  `explorerTxUrl`/`nativeSymbol` helpers the new site can reuse.

### Wave 10 — Verify
- `npm run typecheck` clean · `npm test` green (103 existing + new) · `npm run demo`
  shows a mixed Base+Solana trade record · API payload carries `order.chain`.
  (UI verification belongs to the new-website build — see desktop note.)

## Out of scope (first cut)
- Cross-chain bridging; a Solana `$THESIS` SPL token; Solana holder lottery.
