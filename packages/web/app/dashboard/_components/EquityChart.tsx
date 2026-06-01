/**
 * Portfolio value chart (mockup's big bento `.b-chart`).
 *
 * The mockup faked a random-walk series; we don't. Instead this draws a REAL
 * cumulative-realised-PnL curve assembled from the actual closed positions
 * (ordered by close time), ending at the live total portfolio value — so the
 * line, the headline figure and the all-time delta are all backed by data.
 *
 * Server-rendered (deterministic SVG); the line-draw is a transform-only CSS
 * animation that no-ops under prefers-reduced-motion (global rule in globals.css).
 */
import type { ClosedPositionView, PortfolioSummary } from "@/lib/api";
import { fmtEthSigned, fmtPct, fmtUsd } from "./format";
import styles from "./dashboard.module.css";

export interface EquityChartProps {
  portfolio: PortfolioSummary;
  closedPositions: ClosedPositionView[];
}

const W = 1000;
const H = 240;
const PAD = 8;
const GRID_ROWS = 4;

/** Build a cumulative-realised-PnL series (ETH) from oldest→newest close. The
 *  baseline is the current portfolio value minus total realised PnL, so the
 *  curve climbs from the starting capital to today's value. */
function buildSeries(
  portfolio: PortfolioSummary,
  closed: ClosedPositionView[],
): number[] {
  const ordered = [...closed].sort(
    (a, b) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime(),
  );
  const baseline = portfolio.totalPortfolioValueEth - portfolio.realizedPnlEth;
  const series: number[] = [baseline];
  let running = baseline;
  for (const pos of ordered) {
    running += pos.realisedPnlEth;
    series.push(running);
  }
  // End exactly on the live value (covers unrealised drift + rounding).
  series[series.length - 1] = portfolio.totalPortfolioValueEth;
  return series.length >= 2 ? series : [baseline, portfolio.totalPortfolioValueEth];
}

export function EquityChart({ portfolio, closedPositions }: EquityChartProps) {
  const data = buildSeries(portfolio, closedPositions);
  const min = Math.min(...data) * 0.96;
  const max = Math.max(...data) * 1.02 || 1;
  const span = max - min || 1;

  const x = (i: number) => PAD + ((W - PAD * 2) * i) / (data.length - 1);
  const y = (v: number) => H - PAD - ((H - PAD * 2) * (v - min)) / span;

  const linePath =
    "M" + data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" L");
  const areaPath = `${linePath} L${x(data.length - 1).toFixed(1)},${H} L${PAD},${H} Z`;

  const gridLines = Array.from({ length: GRID_ROWS + 1 }, (_, g) => {
    const gy = PAD + ((H - PAD * 2) * g) / GRID_ROWS;
    const val = (max - span * (g / GRID_ROWS)).toFixed(1);
    return { gy, val };
  });

  const allTimePct =
    portfolio.totalPortfolioValueEth - portfolio.realizedPnlEth > 0
      ? (portfolio.realizedPnlEth /
          (portfolio.totalPortfolioValueEth - portfolio.realizedPnlEth)) *
        100
      : 0;
  const deltaUp = portfolio.realizedPnlEth >= 0;

  return (
    <div className={`${styles.b} ${styles.b2} ${styles.r2} ${styles.bChart}`}>
      <div className={styles.bpad}>
        <div className={styles.chartBig}>
          {portfolio.totalPortfolioValueUsd > 0 ? fmtUsd(portfolio.totalPortfolioValueUsd) : "—"}
          <small>· {portfolio.totalPortfolioValueEth.toFixed(2)} ETH</small>
        </div>
        <div className={`${styles.chartDelta} ${deltaUp ? styles.pos : styles.neg}`}>
          {deltaUp ? "▲" : "▼"} {fmtEthSigned(portfolio.realizedPnlEth)} ETH ·{" "}
          {fmtPct(allTimePct)} all-time realised
        </div>
      </div>
      <svg
        className={styles.chartSvg}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Portfolio value over time"
      >
        <defs>
          <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#E6A33E" stopOpacity="0.16" />
            <stop offset="1" stopColor="#E6A33E" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridLines.map(({ gy, val }) => (
          <g key={gy}>
            <line x1="0" y1={gy} x2={W} y2={gy} stroke="#1f2734" strokeWidth="1" />
            <text x="8" y={gy - 5}>
              {val} ETH
            </text>
          </g>
        ))}
        <path d={areaPath} fill="url(#equityFill)" />
        <path
          className={styles.chartLine}
          d={linePath}
          fill="none"
          stroke="#E6A33E"
          strokeWidth="1.8"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={x(data.length - 1)}
          cy={y(data[data.length - 1])}
          r="3.5"
          fill="#E6A33E"
        />
      </svg>
    </div>
  );
}
