/**
 * Last-24h win highlight + the rolling 7-day win rate — two "is this thing
 * winning right now?" signals the bento's all-time figures don't convey.
 * Mirrors the legacy `#recent-wins` strip and the counters-card 7d win rate.
 *
 * Renders nothing when there's neither a 24h win nor any 7d closes to report,
 * so a quiet week collapses cleanly instead of showing zeros. Server-rendered.
 */
import type { CountersSummary, RecentWinsSummary } from "@/lib/api";
import { fmtRate } from "./format";
import styles from "./dashboard.module.css";

export function RecentWins({
  recentWins,
  counters,
}: {
  recentWins: RecentWinsSummary;
  counters: CountersSummary;
}) {
  const has24h = recentWins.count24h > 0;
  const has7d = counters.winRate7dCount > 0;
  if (!has24h && !has7d) return null;

  return (
    <div className={styles.rwRow}>
      {has24h && (
        <div className={styles.recentWins}>
          <span className={styles.rwIcon} aria-hidden="true">
            ↗
          </span>
          <div>
            <div className={styles.rwHeadline}>
              <b>
                {recentWins.count24h} win{recentWins.count24h === 1 ? "" : "s"}
              </b>
              ,{" "}
              <span className={styles.pos}>+{recentWins.profitEth24h.toFixed(2)} ETH</span> banked
            </div>
            <div className={styles.rwSub}>
              last 24h · {recentWins.closedCount24h} total close
              {recentWins.closedCount24h === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      )}
      {has7d && (
        <div className={styles.wr7d}>
          <div className={styles.kpiL}>Win rate (7d)</div>
          <div className={styles.wr7dV}>{fmtRate(counters.winRate7d)}</div>
          <div className={styles.rwSub}>
            over {counters.winRate7dCount} close{counters.winRate7dCount === 1 ? "" : "s"}
          </div>
        </div>
      )}
    </div>
  );
}
