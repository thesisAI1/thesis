/**
 * The Archive masthead — the visual handshake between the Faculty Office and the
 * Record. Echoes the office's room `.nameTag` (a dark mono pill with a faculty
 * hairline) and the ΘTHESIS brand mark, so arriving from the office's Archive
 * door feels like stepping into the *same world's* filing room — not teleporting
 * to a different app. Pure presentational; stays a Server Component.
 */
import styles from "./dashboard.module.css";

export function ArchiveMasthead() {
  return (
    <header className={styles.masthead}>
      <span className={styles.mastMark} aria-hidden="true">
        Θ
      </span>
      <div className={styles.mastText}>
        <span className={styles.mastPlate}>THE ARCHIVE</span>
        <p className={styles.mastSub}>
          The committee&apos;s filed record — every position, verdict and payout,
          on-chain and verifiable.
        </p>
      </div>
      <span className={styles.mastFile} aria-hidden="true">
        FILE&nbsp;·&nbsp;LIVE
      </span>
    </header>
  );
}
