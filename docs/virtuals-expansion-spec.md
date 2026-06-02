# Virtuals Protocol expansion (Base) — spec

**Goal:** Support Base tokens launched via **Virtuals Protocol** alongside the existing
Clanker / Bankr launchpads — seamlessly, end-to-end (detection → trust gate → buy/sell →
price/PnL → stats → token display → agent copy). Minimal UI.

**Scope (LOCKED — user decision 2026-06-02): GRADUATED VIRTUALS TOKENS ONLY.**
A Virtuals agent token is supported once it has **graduated** from the bonding curve and
has a live `$VIRTUAL`-paired Uniswap V2 pool on Base. Pre-graduation (bonding-curve) tokens
are **out of scope** — they trade only via Virtuals' own bonding contract in `$VIRTUAL` (not
ETH, not on any DEX/aggregator), and the Auditor already vetoes them for lack of pool data.

## Why graduated-only is (almost) purely additive

The bot never builds swap paths — it hands `ETH→token` to the **KyberSwap aggregator**, which
routes `ETH→VIRTUAL→agentToken` (two hops) automatically for a graduated token. So the
buy/sell path needs **zero changes**. The Auditor's quality gates (age, mcap-USD, liquidity-USD,
holder concentration, honeypot) are fed by DexScreener + GoPlus and work unchanged.

The ONE thing that is NOT additive: **price units** (see Wave 3).

## Key facts

- `$VIRTUAL` on Base (chain 8453): `0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b` (deep WETH liquidity).
- Graduation threshold ≈ 42,000 VIRTUAL → LP locked 10y on **Uniswap V2**, paired vs **VIRTUAL**.
- Detection signal (free, no extra call): a graduated Virtuals token's deepest pool is
  **quoted in VIRTUAL**. `DexScreener` returns `quoteToken` per pair → `quoteToken.address === VIRTUAL`
  ⇒ launchpad = `"virtuals"`.

## Waves (TDD, node:test, RED→GREEN per wave)

### Wave 1 — Trust keystone
- `util/launchpad.ts`: add `"virtuals"` to `base` and `"base-sepolia"` trusted sets.
- This auto-flips: `isLaunchpadTrusted`, the Auditor's `launchpadNames()` reasoning text, and
  the gate. No other logic change for trust.
- Auditor doc-comment (`agents/auditor.ts:5-7`) updated to mention Virtuals (cosmetic).
- **RED:** extend `test/launchpad-trust.test.ts` — `isLaunchpadTrusted("base","virtuals") === true`,
  `trustedLaunchpads("base")` includes `"virtuals"`, still rejects `pumpfun`/unknown on base.

### Wave 2 — Detection (VIRTUAL-quoted ⇒ "virtuals")
- New pure module `adapters/basedata/base-launchpad.ts` (mirrors `solana-launchpad.ts`):
  `detectVirtualsLaunchpad(pairs, virtualAddress): "virtuals" | null` — true when any pool's
  `quoteToken.address` equals VIRTUAL.
- `config.ts` `chain`: add `virtualToken: str("BASE_VIRTUAL_TOKEN", "0x0b3e…")`.
- `adapters/basedata/real.ts`: add `quoteToken` to the `DexPair` interface; `fetchMarket` computes
  `launchpadFromPairs = detectVirtualsLaunchpad(pools, config.chain.virtualToken)`; `getToken`
  sets `launchpad = detected(bankr/clanker) ?? launchpadFromPairs`. (detect bankr/clanker first;
  Virtuals tokens are deployed by Virtuals, so no conflict.)
- `adapters/basedata/mock.ts`: deterministic sentinel — an address containing `"virtuals"`
  ⇒ launchpad `"virtuals"` (mirrors Solana `"pump"`-suffix rule), for tests/demo.
- **RED:** new `test/base-launchpad-detect.test.ts` (pure fn); `test/auditor-virtuals.test.ts`
  (a virtuals-tagged mock token clears the launchpad gate — no `not launched via` flag,
  `report.launchpad === "virtuals"`).

### Wave 3 — Price units (VIRTUAL→ETH) — the correctness fix
**Problem:** `fetchMarket` sets `priceEth = Number(pool.priceNative)`. For a VIRTUAL-quoted pool
`priceNative` is price-in-VIRTUAL, not ETH. This corrupts `entryPriceEth` (recorded at buy via
`getTokenPriceEth → getPriceEth`), the monitor's TP/SL gates (`monitor/index.ts` `getPricesEth`),
and dashboard `unrealizedPnlEth`. Actual sell proceeds are safe (KyberSwap `quoteSell` = real ETH);
tier fractions are safe (off `entryTokens`). marketCapUsd/liquidityUsd are safe (USD fields).
- **Surgical fix:** make `priceNative→priceEth` quote-aware. `priceEth = priceNative × rate`,
  where `rate = 1` for WETH-quoted pools (Clanker/Bankr — UNCHANGED) and `rate = VIRTUAL/ETH`
  for VIRTUAL-quoted pools. Get VIRTUAL/ETH from DexScreener for the VIRTUAL token's deepest
  WETH pool's `priceNative`; cache in-memory (~60s) so a monitor tick is one fetch.
- Apply in BOTH `fetchMarket` (single) and `getPricesEth` (batch).
- Pure helper `toEthPrice(priceNative, quoteAddr, { virtual, virtualEthRate })` for testing.
- **RED:** `test/virtuals-price-units.test.ts` — WETH-quoted unchanged (×1); VIRTUAL-quoted ×rate;
  rate 0/missing → falls back safely (do not silently mislabel).

### Wave 4 — Agent copy + behavior
- `agents/dean.ts:160`: add `"Virtuals"` to the proper-noun trusted-launchpad context line
  (so the Dean LLM treats "Virtuals" as a launchpad name, a positive signal — not the adjective).
- Docs/marketing copy (web): `app/docs/_components/FacultyTable.tsx` (launchpad origin line),
  `app/pitch/page.tsx` (launchpad trust copy) — enumerate Clanker/Bankr/Virtuals.
- **Test:** characterization — Dean prompt string contains "Virtuals"; copy is grep-verified.

### Wave 5 — Config docs + full verify
- `.env.example`: document `BASE_VIRTUAL_TOKEN`.
- Full backend `node:test` suite green + `tsc` clean across shared/backend/web.
- `npm run demo` (or a mock virtuals address) opens a virtuals position; dashboard shows it with
  correct ETH PnL.

### Wave 6 — launchpad source badge (DONE — user approved)
Per-token "Clanker / Bankr / Virtuals" badge in the dashboard. `ReviewRecord.launchpad`
(shared) populated at `service.ts` saveReview from `tokenReport.launchpad`; FileStore auto-carries
(JSON); PrismaStore + `schema.prisma` `Review.launchpad String?` + additive migration
`20260602000000_add_review_launchpad` (vitest harness replays all migrations → auto-applied).
Server `buildDashboardPayload` joins via `launchpadByPosition` (+ by-address fallback) onto
`OpenPositionView` + the closed view; web `lib/api.ts` views carry `launchpad`; `TokenCell`
renders a `.lpBadge` pill (per-source color via `data-lp`). RED→GREEN on the store-contract
round-trip. Verified: node:test 195/195, vitest 54/54, tsc 0 (×3), runtime join proof, next build 0.

## Out of scope
- Pre-graduation bonding-curve trading (would need: VIRTUAL acquisition, direct bonding-contract
  calls with a reverse-engineered ABI, a Virtuals API data path, new Auditor logic).
- Solana Virtuals (Virtuals also launched on Solana) — Base-only here.
