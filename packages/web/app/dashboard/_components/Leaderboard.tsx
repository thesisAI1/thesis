/**
 * Section 04 — Author Leaderboard (mockup `#leaderboard`). Server-rendered table
 * ranked by realised author share. Top-3 ranks get the medal tints; the avatar
 * falls back to the author's initials when no image is on file.
 */
import type { LeaderboardEntry } from "@/lib/api";
import { fmtPct, fmtRate, initials } from "./format";
import styles from "./dashboard.module.css";

export interface LeaderboardProps {
  entries: LeaderboardEntry[];
}

function rankClass(rank: number): string {
  if (rank === 1) return `${styles.rank} ${styles.r1}`;
  if (rank === 2) return `${styles.rank} ${styles.r2}`;
  if (rank === 3) return `${styles.rank} ${styles.r3}`;
  return styles.rank;
}

export function Leaderboard({ entries }: LeaderboardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.tblWrap}>
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
            {entries.length ? (
              entries.map((e) => (
                <tr key={e.xUserId}>
                  <td>
                    <span className={rankClass(e.rank)}>{e.rank}</span>
                  </td>
                  <td>
                    <span className={styles.lbAuthor}>
                      {e.authorAvatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className={styles.lbAv}
                          src={e.authorAvatarUrl}
                          alt=""
                          width={26}
                          height={26}
                        />
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
                  <td className={`${styles.tRight} ${styles.earned}`}>
                    {e.totalEarnedEth.toFixed(2)} Ξ
                  </td>
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
    </div>
  );
}
