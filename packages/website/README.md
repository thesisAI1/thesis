# @thesis/website

The live transparency dashboard — the public record of every trade, review,
and profit split the committee makes.

The static front end lives in `public/` (`index.html`, `styles.css`, `app.js`,
`favicon.svg`) — no build step. It is served by the backend HTTP server, so
just run the backend and open <http://localhost:4319>.

## What it shows

- **The Faculty Room** — a live feed of the five agents deliberating, streamed
  over Server-Sent Events as each submission is reviewed.
- **The dashboard** — portfolio value and PnL, open and closed positions, the
  triage funnel, the decision log, and the 25/25/25/25 profit distribution.

It is **read-only**: there is no login, no wallet-connect, and nothing that
mutates state. Author payouts happen entirely on X, not on the website.

## Author payouts

There is no registration. When a winning trade closes, the agent replies to
the author's original thesis asking them to reply with a Base wallet address;
the payout is sent on-chain to a reply from the original author only. See
`DESIGN.md` §7 and `packages/backend/src/payout/`.
