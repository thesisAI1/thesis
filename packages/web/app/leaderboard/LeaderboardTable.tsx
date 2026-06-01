"use client";

/**
 * The full author leaderboard, paginated 10 rows per page (via the shared
 * usePagination + Pager) inside a scroll-capped box with a sticky header — so a
 * long roster never stretches the page. Ranked by realised author share; the
 * top-3 ranks keep their medal tints. Reuses the dashboard table styling so the
 * leaderboard reads identically here and on /dashboard.
 */
import type { LeaderboardEntry } from "@/lib/api";
import { usePagination, Pager } from "@/app/dashboard/_components/Pager";
import { fmtPct, fmtRate, initials } from "@/app/dashboard/_components/format";
import styles from "@/app/dashboard/_components/dashboard.module.css";

const PAGE_SIZE = 10;

function rankClass(rank: number): string {
  if (rank === 1) return `${styles.rank} ${styles.r1}`;
  if (rank === 2) return `${styles.rank} ${styles.r2}`;
  if (rank === 3) return `${styles.rank} ${styles.r3}`;
  return styles.rank;
}

export function LeaderboardTable({ entries }: { entries: LeaderboardEntry[] }) {
  const p = usePagination(entries, PAGE_SIZE);

  return (
    <div className={styles.card}>
      <div className={`${styles.tblWrap} ${styles.tblScroll}`}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: 42 }}>#</th>
              <th>Author</th>
              <th className={styles.tRight}>Funded</th>
              <th className={styles.tRight}>Win rate</th>
              <th className={styles.tRight}>Best call</th>
              <th className={styles.tRight}>Earned</th>
            </tr>
          </thead>
          <tbody>
            {p.pageItems.length ? (
              p.pageItems.map((e) => (
                <tr key={e.xUserId}>
                  <td>
                    <span className={rankClass(e.rank)}>{e.rank}</span>
                  </td>
                  <td>
                    <span className={styles.lbAuthor}>
                      {e.authorAvatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className={styles.lbAv} src={e.authorAvatarUrl} alt="" width={26} height={26} />
                      ) : (
                        <span className={styles.lbAv}>{initials(e.authorHandle)}</span>
                      )}
                      {e.authorHandle}
                    </span>
                  </td>
                  <td className={styles.tRight}>{e.funded}</td>
                  <td className={styles.tRight}>{fmtRate(e.winRate)}</td>
                  <td className={styles.tRight}>
                    <span className={e.bestTradePct >= 0 ? styles.pos : styles.neg}>
                      {fmtPct(e.bestTradePct)}
                    </span>
                  </td>
                  <td className={`${styles.tRight} ${styles.earned}`}>{e.totalEarnedEth.toFixed(2)} Ξ</td>
                </tr>
              ))
            ) : (
              <tr className={styles.emptyRow}>
                <td colSpan={6}>No authors funded yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager p={p} noun="authors" />
    </div>
  );
}
