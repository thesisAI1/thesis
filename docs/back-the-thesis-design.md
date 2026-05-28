# Back the Thesis — Feature Design Doc

**Status:** In design (mid-discussion). NOT shipped.
**Last updated:** 2026-05-27
**Owner:** @thesisonbase

---

## 1. The idea

Today, anyone who is not the author of a thesis can only watch. They see the
committee fund a position, then sit on the sidelines while it plays out.

**Back the Thesis** lets any user put skin in the game on an open position by
burning $THESIS. If the position closes in profit, backers share a slice of the
profit pro-rata to what they burned. If it closes in loss, the burn is lost (no
refund — it's the cost of conviction).

Three things this is designed to achieve:

1. **Engagement** — spectators become participants, not just watchers.
2. **$THESIS demand** — backers must burn $THESIS to participate, creating real
   ongoing buy pressure tied to project traction.
3. **Marketing flywheel** — backers become advocates ("I backed this thesis,
   look at it now"), spreading attention without the team paying for it.

---

## 2. Locked decisions

These have been discussed and agreed.

### 2.1 Terminology (Topic 1 — DONE)

- Action verb: **"Back"** (button label: "Back this thesis")
- Participants: **"backers"**
- Payment language: **"burn"** ("burn THESIS to back this thesis")
- Window name: **"backing window"**
- Pool name: **"backer pool"**
- **Never** use the words "bet" / "lottery" / "wager" anywhere in product or
  copy — regulatory framing + brand positioning.

### 2.2 Snipe protection (Topic 2 — DONE)

The backing window closes when **whichever comes first**:

- 15 minutes after the position opens, OR
- Unrealised PnL reaches +50%, OR
- The per-trade cap fills (all 10 backer slots used)

**Why 15 minutes**: enough time for active X followers to see, decide, burn,
back; not so long that the trade's direction is obvious.

**Why +50% cap**: protects against fast pumps. If the token rips +50% in 4
minutes, we don't let late backers ride a near-certain win.

**Visual countdown** shown in the dashboard next to every open position.

**X reply mention**: when the buy is announced on X, the reply text includes
"Backing window open for 15 min".

**No refunds**: if the position closes at a loss (stop-out, slow bleed, fast
rug — anything), backers lose their burn. Non-negotiable rule of the game.

### 2.3 Sybil resistance & sizing (Topic 3 — DONE)

| Param | Value | Rationale |
|---|---|---|
| Conversion | 1 THESIS = 1 credit | Clean 1:1 mental model |
| Click size (smallest unit) | 1000 credits (~$0.001 = 0.1 cent) | Bets feel cheap |
| Per-wallet max per trade | 250,000 credits (~$0.24) | Anti-whale, math-safe |
| Max backers per trade | 10 | FOMO scarcity |
| Distribution | Pro-rata to credits spent | Sybil-resistant |
| Per-wallet max scaling | Static (no auto-scale with pool size) | Simpler, revisit later |
| Pool source | 25% of trade profit | Author / portfolio / buyback all stay 25% each |

**Why pro-rata to burns, not equal split:** equal split is Sybil-able with
multi-wallet accounts. Pro-rata neutralises this — same total burn gives same
share regardless of how many wallets it came from.

**Why 250K max per wallet:** worked backward from EV math. Pool ≈ $7.50 with
$30 trade profit. For backers to be positive EV at 35% win rate, total burns
need to stay under ~$2.50. With 10 backers max, that means $0.25 per wallet
max → 250K credits.

### 2.4 EV reality check (locked in math)

At current trade sizes (~$30 profit per win):

| Scenario | Total burns | EV at 35% win rate |
|---|---|---|
| All 10 backers at max (250K each) | $2.44 | +$0.018 (marginal positive) |
| 5 backers at half-max (125K each) | $0.61 | +$0.40 (healthy) |
| 1 lonely backer at max | $0.24 | +$2.40 (jackpot) |

As the portfolio compounds and trade sizes grow, all numbers improve linearly.
The structure is **self-balancing**: when many people pile in, individual EV
drops; when few do, EV is great. Natural correction.

---

## 3. In-progress topic

### Topic 4 — Wallet-less flow architecture (UNDER DISCUSSION)

**The constraint:** user wants minimal wallet interaction with the website
("an ginete na min kanei connect to metamask h to wallet tou sto website").

**The proposal as it currently stands:**

**(A) Pre-burn flow — TRUE zero website interaction**

1. User goes to dashboard, sees instructions:
   > "Send any amount of $THESIS to `0x000…dEaD` from any wallet. Credits
   > appear within 2 min, no signup required."
2. User opens any wallet they like (Coinbase, Rabby, Trust, mobile, hardware)
   and does a plain ERC20 transfer of THESIS to the burn address.
3. Backend polls Alchemy's `alchemy_getAssetTransfers` every ~60s, filtered to
   transfers TO `0xdEaD` with contract = THESIS token.
4. For each new transfer:
   - sender = user's wallet
   - amount = N THESIS → N credits
   - Idempotency check by txHash to avoid double-crediting
   - Backend credits the sender wallet's account in our DB.

**(B) View credits — read-only, no auth**

User visits site, enters their wallet address (or it's auto-detected from
SIWE if already logged in). Sees credit balance, backing history, payout
history. Read-only.

**(C) Backing action — requires SIWE (the open question)**

This is where the open issue is. **We need some form of authentication for
backing actions** — otherwise anyone who knows a wallet address could spend
that wallet's credits.

Three options analysed:

| Option | UX | Wallet involvement |
|---|---|---|
| B1. SIWE (Sign-In with Ethereum) | One wallet signature per ~7-day session. No gas. No tx. Just a signature. Subsequent backs in that session = 1 click. | One popup per week |
| B2. Per-back on-chain tx | Every back is a tiny on-chain tx with gas (~$0.005 each). Defeats cheap-clicks UX entirely. | tx per back |
| B3. Manual signature paste | User copies challenge from site, signs in wallet manually, pastes signature back. Brutally bad UX. | None on site |

**Recommendation**: B1 (SIWE) is the only option that respects:
- Cheap clicks (no gas per back)
- Security (only wallet owner spends credits)
- Wallet-flexibility (any wallet works, not MetaMask-specific)

**Honest framing for users**: SIWE is NOT "wallet connect" in the move-funds
sense. It's just a signature proving you control the wallet. No gas, no funds
move, no contract interaction. One popup, then free clicks for ~7 days.

**(D) Payout — fully automatic, zero interaction**

When position closes in profit:
1. Backend calculates each backer's share = (credits_spent / total_credits) × pool
2. Backend transfers ETH directly to backer's wallet
3. Backer sees ETH appear, no claim action needed

### Decisions PENDING in Topic 4

1. Burn flow via Alchemy polling — confirm YES
2. Burn destination: standard `0x000…dEaD` (recommended) vs custom contract
3. Backing auth: SIWE (recommended) vs alternative
4. SIWE session duration: 7 days (recommended) vs 1 / 30
5. Payout: automatic ETH to pre-burn wallet — confirm YES

---

## 4. Open topics (not yet discussed)

These were on the original list but haven't been worked through yet.

### Topic 5: Reward pool source
Already implicitly locked at 25% from team cut. Keep author 25% / portfolio
25% / buyback 25% intact. Final confirmation pending.

### Topic 6: Bet limits
Min/max amount — partially decided in Topic 3 (1000 credits min click, 250K
max per wallet per trade). May need a "minimum backing per wallet per trade"
to prevent dust (e.g., must spend at least 1000 credits = $0.001 to back at
all). Likely fine as-is.

### Topic 7: Author backing own thesis
Open question: should authors be allowed to back their own theses?
Recommendation: YES — extra skin in the game, signals conviction, no abuse
vector.

### Topic 8: Edge case — zero backers
Already implicitly handled: if no one backs a position, the 25% pool stays
with the team (current default behaviour). No code change needed.

### Topic 9: Author bonus
Open: should authors get an extra slice from bettors (e.g., 5% of the backer
pool) so the author stays the hero of the project rather than being eclipsed?
Not yet decided.

### Topic 10: X integration
Recommendation: agent's buy-announcement reply on X should include
"Backing window open for 15 min — back this thesis at thesisonbase.com/position/{id}".
Drives traffic to dashboard at the perfect moment.

### Topic 11: UI placement
Open: where on the dashboard does the "Back this thesis" button appear?
- Inline with each open position row, OR
- Dedicated /backing page with full details, OR
- Both

Also: how is "Current backers: 7 · Pool: 1.2M credits" displayed?

### Topic 12: MVP scope
What ships in Phase 1, what's deferred to Phase 2.

Suggested Phase 1:
- Pre-burn flow + Alchemy polling
- SIWE auth
- Back button + credit spending UI
- Pro-rata payout on profitable close
- Countdown timer on positions
- Basic backer list per position

Suggested Phase 2 (later):
- Backer leaderboard
- Auto-back rules ("auto-back every A-grade trade with N credits")
- Smart contract for backing if traction warrants it
- Trade card NFTs for big wins

---

## 5. Concerns flagged & accepted

1. **Custodial DB risk**: credits live in our DB, not on-chain. If DB corrupts
   or is hacked, users could lose credit balances. Acceptable trade-off for
   the UX win. Mitigation: periodic on-chain snapshots of balances for
   transparency / disaster recovery.

2. **Negative EV in early days at max participation**: at max-10-backers-each-
   at-max-burn, EV is barely positive (+$0.02). Users who are unlucky early
   may feel scammed. Honest copy required: "Most plays will lose. When one
   hits, you share the upside." Frame as conviction stake, not investment.

3. **Regulatory**: even with "Back" framing, distributing profits based on
   trade outcomes could attract scrutiny in some jurisdictions. Not blocking
   for V1 but worth a legal review if traction grows.

4. **Author centrality risk**: backing system shouldn't eclipse the author.
   Topic 9 (author bonus from backer pool) is the lever to prevent this.

---

## 6. Where we paused

End of Topic 4 discussion. User was about to sleep. Tomorrow:
- Confirm Topic 4 decisions (5 items above)
- Move through Topics 5-12 in order
- After all topics locked, write technical implementation spec

## 7. Conversation thread context

The full design conversation lives in the Claude session that preceded this
doc. Key moments:
- Original idea: "bet on thesis like a lottery, $1 tickets, equal split"
- Pushed back on fixed-$1 tickets (Sybil), proposed pro-rata by burn
- Proposed dynamic backer cap based on pool size
- User counter-proposed: 100M cap per trade, 1M-10M per wallet, FCFS
- Worked back from math: at $30 trade profit / $7.50 pool, the cap structure
  has to keep total burns under ~$2.50 for backers to break even at 35% win
  rate
- Landed on: 1 THESIS = 1 credit, 250K max per wallet per trade, 10 backers
  max, 1000 credits per click (~0.1 cent)
- Started Topic 4 (wallet-less flow), proposed SIWE for backing auth as the
  least-bad option that preserves cheap-clicks UX
