/**
 * The triage-funnel one-liner — pipeline throughput from mention → review →
 * queue. Mirrors the legacy `#funnel-line`. Shows what the committee is
 * processing behind the scenes, not just the trades that made it through.
 * Server-rendered — pure presentational.
 */
import type { FunnelSummary } from "@/lib/api";
import styles from "./dashboard.module.css";

export function FunnelLine({ funnel }: { funnel: FunnelSummary }) {
  return (
    <p className={styles.funnelLine}>
      Triage funnel — <b>{funnel.seen}</b> mentions seen · <b>{funnel.passed}</b> passed the
      filters · <b>{funnel.reviewed}</b> fully reviewed · <b>{funnel.queued}</b> waiting in the
      queue
    </p>
  );
}
