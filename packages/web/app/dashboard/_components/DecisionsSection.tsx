"use client";

/**
 * Section 03 — Decision Log (mockup `#decisions`). The recent-reviews feed:
 * grade chip, BUY/SKIP verdict, author, the graded token (truncated CA with a
 * copy button — reviews carry no symbol), and the Dean's rationale. Filterable
 * by verdict.
 */
import { useMemo, useState } from "react";
import type { Decision, ReviewRecord } from "@thesis/shared";
import { CopyButton } from "@/components/shell/CopyButton";
import { gradeClass, timeAgo, truncate } from "./format";
import styles from "./dashboard.module.css";

export interface DecisionsSectionProps {
  reviews: ReviewRecord[];
}

type Filter = "all" | Decision;

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "ALL" },
  { key: "BUY", label: "BUY" },
  { key: "SKIP", label: "SKIP" },
];

export function DecisionsSection({ reviews }: DecisionsSectionProps) {
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo(
    () => reviews.filter((r) => filter === "all" || r.decision === filter),
    [reviews, filter],
  );

  return (
    <>
      <div className={styles.filters}>
        <span className={styles.flabel}>Verdict</span>
        <div className={styles.chips}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={filter === f.key ? styles.on : ""}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`${styles.log} ${styles.logScroll}`}>
        {rows.length ? (
          rows.map((r) => (
            <div className={styles.logItem} key={`${r.postId}-${r.reviewedAt}`}>
              <div className={`${styles.logGrade} ${styles[gradeClass(r.grade)]}`}>
                {r.grade}
              </div>
              <div>
                <div className={styles.logTop}>
                  <span className={styles.logHandle}>{r.authorHandle}</span>
                  <span className={styles.tok}>{truncate(r.contractAddress)}</span>
                  <CopyButton value={r.contractAddress} title="Copy contract address" />
                  <span className={styles.logScores}>
                    REG {r.authorScore} · AUD {r.tokenScore}
                  </span>
                </div>
                <div className={styles.logRationale}>{r.rationale}</div>
              </div>
              <div className={styles.logSide}>
                <span
                  className={`${styles.badge} ${r.decision === "BUY" ? styles.badgeBuy : styles.badgeSkip}`}
                >
                  {r.decision}
                </span>
                <div className={styles.logTime}>{timeAgo(r.reviewedAt)}</div>
              </div>
            </div>
          ))
        ) : (
          <div className={styles.logItem} style={{ justifyContent: "center" }}>
            <span className={styles.author}>No decisions match the filter.</span>
          </div>
        )}
      </div>
    </>
  );
}
