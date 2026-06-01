/**
 * Profit distribution — the 4-way split every winning trade makes (25% each).
 * Mirrors the legacy `#dist-grid`: authors / trading portfolio / holder lottery
 * / $THESIS buyback & burn.
 *
 * The bento (§01) surfaces authors + buyback as point-in-time KPIs; this block
 * is the canonical "where every winning trade goes" explainer, and is the ONLY
 * place on the Archive where the trading-portfolio and holder-lottery legs
 * appear. Server-rendered — pure presentational.
 */
import type { CSSProperties } from "react";
import type { DistributionsSummary } from "@/lib/api";
import styles from "./dashboard.module.css";

/** The four legs, in legacy order, each with its accent colour and label. */
const LEGS: Array<{
  key: "toAuthors" | "toPortfolio" | "toTeam" | "toBuyback";
  color: string;
  label: string;
}> = [
  { key: "toAuthors", color: "#4F9DDE", label: "To authors" },
  { key: "toPortfolio", color: "#3FB984", label: "To trading portfolio" },
  // `toTeam` holds the holder-lottery slice post-rename (see backend payload).
  { key: "toTeam", color: "#9B6BDF", label: "Holder lottery — 5 winners" },
  { key: "toBuyback", color: "#E0653E", label: "$THESIS buyback & burn" },
];

export function DistributionSplit({
  distributions,
}: {
  distributions: DistributionsSummary;
}) {
  return (
    <div className={styles.distBlock}>
      <h3 className={styles.blockTitle}>Profit distribution</h3>
      <p className={styles.blockSub}>Every winning trade splits four ways — 25% each.</p>
      <div className={styles.distGrid}>
        {LEGS.map((leg) => (
          <div
            className={styles.distCard}
            style={{ "--c": leg.color } as CSSProperties}
            key={leg.key}
          >
            <div className={styles.distPct}>25%</div>
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
