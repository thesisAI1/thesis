/**
 * Inline `(wins/total)` chip rendered after an author handle in the position
 * tables, tinted by win-rate (green ≥ 50%, neutral below). Mirrors the legacy
 * `authorStatsBadge`. Renders nothing when the author has no closed trades yet,
 * so a fresh author's row stays clean.
 */
import type { AuthorStat } from "@/lib/api";
import styles from "./dashboard.module.css";

export function AuthorStatsBadge({ stat }: { stat: AuthorStat | undefined }) {
  if (!stat || !stat.total) return null;
  const good = stat.winRate >= 0.5;
  return (
    <span
      className={`${styles.authorStats} ${good ? styles.asGood : styles.asMid}`}
      title={`${stat.wins} wins of ${stat.total} closed`}
    >
      ({stat.wins}/{stat.total})
    </span>
  );
}
