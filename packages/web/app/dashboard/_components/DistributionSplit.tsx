/**
 * Profit distribution — the 3-way split every winning trade makes:
 * 25% authors / 50% trading portfolio / 25% $THESIS buyback & burn.
 *
 * The bento (§01) surfaces authors + buyback as point-in-time KPIs; this block
 * is the canonical "where every winning trade goes" explainer, and is the ONLY
 * place on the Archive where the trading-portfolio leg appears. Server-rendered
 * — pure presentational.
 */
import type { CSSProperties } from "react";
import type { DistributionsSummary } from "@/lib/api";
import styles from "./dashboard.module.css";

/** The three legs, each with its share, accent colour and label. */
const LEGS: Array<{
  key: "toAuthors" | "toPortfolio" | "toBuyback";
  pct: string;
  color: string;
  label: string;
}> = [
  { key: "toAuthors", pct: "25%", color: "#4F9DDE", label: "To authors" },
  { key: "toPortfolio", pct: "50%", color: "#3FB984", label: "To trading portfolio" },
  { key: "toBuyback", pct: "25%", color: "#E0653E", label: "$THESIS buyback & burn" },
];

export function DistributionSplit({
  distributions,
}: {
  distributions: DistributionsSummary;
}) {
  return (
    <div className={styles.distBlock}>
      <h3 className={styles.blockTitle}>Profit distribution</h3>
      <p className={styles.blockSub}>Every winning trade splits three ways — 25% author · 50% portfolio · 25% buyback.</p>
      <div className={styles.distGrid}>
        {LEGS.map((leg) => (
          <div
            className={styles.distCard}
            style={{ "--c": leg.color } as CSSProperties}
            key={leg.key}
          >
            <div className={styles.distPct}>{leg.pct}</div>
            {/* `?? 0` guards deploy skew: an older backend that omits a leg would
                otherwise throw on `.toFixed` and crash the whole overview slot. */}
            <div className={styles.distValue}>{(distributions[leg.key] ?? 0).toFixed(2)} ETH</div>
            <div className={styles.distLabel}>{leg.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
