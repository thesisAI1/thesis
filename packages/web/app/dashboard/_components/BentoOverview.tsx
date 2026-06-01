/**
 * Section 01 — the bento KPI overview (mockup `.bento`).
 *
 * Server-rendered. All figures come from the live dashboard payload:
 *   - big chart cell .............. EquityChart (portfolio value + realised curve)
 *   - hero KPI .................... portfolio value (USD + ETH, open count)
 *   - realised PnL ............... portfolio.realizedPnlEth
 *   - win rate ................... portfolio.winRate (+ wins / closed)
 *   - funded ..................... reviews.buys of reviews.total
 *   - split donut ............... distributions, with the centre showing the
 *                                 BRIEF-MANDATED "Total paid to authors"
 *                                 (replaces the mockup's neutral "each" cell)
 *   - buyback & burn ............ distributions.toBuyback
 *   - latest close .............. most recent closed position (links to §02)
 */
import type {
  ClosedPositionView,
  DistributionsSummary,
  PortfolioSummary,
  ReviewsSummary,
} from "@/lib/api";
import { EquityChart } from "./EquityChart";
import {
  CheckIcon,
  FlameIcon,
  TrendUpIcon,
  TrophyIcon,
  WalletIcon,
} from "./icons";
import { fmtEthSigned, fmtRate, fmtUsd, timeAgo, tokenLabel } from "./format";
import { nativeSymbol } from "@/lib/chain";
import styles from "./dashboard.module.css";

export interface BentoOverviewProps {
  portfolio: PortfolioSummary;
  reviews: ReviewsSummary;
  distributions: DistributionsSummary;
  closedPositions: ClosedPositionView[];
}

/** USD suffix for an ETH amount, only when a spot price is known. */
function usdSuffix(eth: number, ethUsdPrice: number): string | null {
  if (ethUsdPrice <= 0) return null;
  return fmtUsd(eth * ethUsdPrice);
}

export function BentoOverview({
  portfolio,
  reviews,
  distributions,
  closedPositions,
}: BentoOverviewProps) {
  const latest = [...closedPositions].sort(
    (a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime(),
  )[0];

  const authorsUsd = usdSuffix(distributions.toAuthors, portfolio.ethUsdPrice);
  const buybackUsd = usdSuffix(distributions.toBuyback, portfolio.ethUsdPrice);
  const realisedUp = portfolio.realizedPnlEth >= 0;

  return (
    <div className={styles.bento}>
      {/* big value chart (spans 2x2) */}
      <EquityChart portfolio={portfolio} closedPositions={closedPositions} />

      {/* hero — portfolio value */}
      <div className={`${styles.kpi} ${styles.kpiHero}`}>
        <div className={styles.kpiHead}>
          <span className={styles.kpiIco}>
            <WalletIcon />
          </span>
          <span className={styles.kpiL}>Portfolio value</span>
        </div>
        <div className={styles.kpiV}>
          {portfolio.totalPortfolioValueUsd > 0
            ? fmtUsd(portfolio.totalPortfolioValueUsd)
            : `${portfolio.totalPortfolioValueEth.toFixed(2)} ETH`}
        </div>
        <div className={styles.kpiN}>
          {portfolio.totalPortfolioValueEth.toFixed(2)} ETH · wallet +{" "}
          {portfolio.openCount} open
        </div>
      </div>

      {/* realised PnL */}
      <div className={styles.kpi}>
        <div className={styles.kpiHead}>
          <span className={styles.kpiIco}>
            <TrendUpIcon />
          </span>
          <span className={styles.kpiL}>Realised PnL</span>
        </div>
        <div className={`${styles.kpiV} ${realisedUp ? styles.pos : styles.neg}`}>
          {fmtEthSigned(portfolio.realizedPnlEth)} ETH
        </div>
        <div className={styles.kpiN}>since inception</div>
      </div>

      {/* win rate */}
      <div className={styles.kpi}>
        <div className={styles.kpiHead}>
          <span className={styles.kpiIco}>
            <TrophyIcon />
          </span>
          <span className={styles.kpiL}>Win rate</span>
        </div>
        <div className={styles.kpiV}>{fmtRate(portfolio.winRate)}</div>
        <div className={styles.kpiN}>
          {portfolio.winCount} / {portfolio.closedCount} closed
        </div>
      </div>

      {/* funded */}
      <div className={styles.kpi}>
        <div className={styles.kpiHead}>
          <span className={styles.kpiIco}>
            <CheckIcon />
          </span>
          <span className={styles.kpiL}>Funded</span>
        </div>
        <div className={styles.kpiV}>{reviews.buys}</div>
        <div className={styles.kpiN}>of {reviews.total} reviewed</div>
      </div>

      {/* Total paid to authors — the featured KPI (replaces the profit-distribution
          donut, per the dashboard spec). Keeps the b2 footprint so the bento grid
          layout is unchanged; the 25/25/25/25 split is still shown on the homepage
          and in the docs. */}
      <div className={`${styles.b} ${styles.b2} ${styles.bpad} ${styles.bstat}`}>
        <div className={styles.kpiL}>Total paid to authors</div>
        <div
          className={styles.bigv}
          style={{ color: "var(--blue)", fontSize: "40px", lineHeight: 1.1, marginTop: "6px" }}
        >
          {distributions.toAuthors.toFixed(2)} ETH
        </div>
        <div className={styles.kpiN}>
          {authorsUsd ? `${authorsUsd} · ` : ""}25% author share · {distributions.count} paid on X
        </div>
      </div>

      {/* buyback & burn */}
      <div className={`${styles.b} ${styles.bpad} ${styles.bstat}`}>
        <div className={styles.kpiL}>
          <span className={styles.kpiIco} style={{ display: "inline-block", verticalAlign: "-2px" }}>
            <FlameIcon />
          </span>{" "}
          Buyback &amp; burn
        </div>
        <div className={styles.bigv} style={{ color: "var(--accent)" }}>
          {distributions.toBuyback.toFixed(2)} ETH
        </div>
        <div className={styles.kpiN}>
          {buybackUsd ? `${buybackUsd} · ` : ""}$THESIS removed
        </div>
      </div>

      {/* latest close → links to §positions */}
      <a className={`${styles.b} ${styles.bstat}`} href="#positions">
        <div className={styles.activity}>
          <div style={{ width: "100%" }}>
            <div className={styles.kpiL}>Latest close</div>
            {latest ? (
              <>
                <div
                  className={`${styles.bigv} ${latest.realisedPnlEth >= 0 ? styles.pos : styles.neg}`}
                >
                  {fmtEthSigned(latest.realisedPnlEth)} {nativeSymbol(latest.chain)}
                </div>
                <div className={styles.kpiN}>
                  {tokenLabel(latest.tokenSymbol, latest.contractAddress)} ·{" "}
                  {latest.authorHandle} · {timeAgo(latest.closedAt)}
                </div>
              </>
            ) : (
              <>
                <div className={styles.bigv} style={{ color: "var(--dim)" }}>
                  —
                </div>
                <div className={styles.kpiN}>no closes yet</div>
              </>
            )}
          </div>
        </div>
      </a>
    </div>
  );
}
