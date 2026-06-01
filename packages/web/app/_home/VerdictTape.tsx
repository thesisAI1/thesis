"use client";

/**
 * The verdict tape (design `.tape`): a paused-on-hover marquee of the committee's
 * most recent REAL calls — author · token · grade · BUY/SKIP · result. The track
 * is doubled so the -50% keyframe loops seamlessly.
 *
 * Hydrated from the live dashboard: each recent review is joined to its open /
 * closed position (by contract address) to recover the token symbol and the
 * result figure. SKIPs and not-yet-traded buys read "—". Renders nothing until
 * the committee has actually reviewed something — no fabricated feed.
 */
import type { DashboardData, Grade } from "@/lib/api";
import styles from "./home.module.css";

interface TapeEntry {
  key: string;
  handle: string;
  token: string;
  grade: Grade;
  decision: "BUY" | "SKIP";
  result: string;
}

const GRADE_COLOR: Record<Grade, string> = {
  A: "var(--green)",
  B: "var(--blue)",
  C: "var(--accent)",
  D: "var(--red)",
  F: "var(--red)",
};

/** Marquee reads thin with only a couple of entries; repeat the real set up to
 *  this many before doubling, so the track always fills the bar. */
const MIN_TAPE_ITEMS = 8;

function shortCa(a: string): string {
  const s = String(a || "");
  return s.length > 10 ? `${s.slice(0, 5)}…${s.slice(-3)}` : s || "—";
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${Math.abs(n) >= 10 ? Math.round(n) : n.toFixed(1)}%`;
}

function resultColor(result: string): string {
  if (result === "—") return "var(--muted)";
  return result.startsWith("+") ? "var(--green)" : "var(--red)";
}

/**
 * Build the tape from real dashboard data. Closed positions override open ones
 * for a given token — a realised result is the truer headline than an unrealised
 * one. The result only shows for BUYs that actually opened a position; SKIPs and
 * buys we can't match to a position read "—".
 */
export function buildTapeEntries(data: DashboardData | null): TapeEntry[] {
  if (!data) return [];
  const byCa = new Map<string, { token: string; result: string }>();
  for (const o of data.openPositions ?? []) {
    byCa.set(o.contractAddress.toLowerCase(), {
      token: o.tokenSymbol ? `$${o.tokenSymbol}` : shortCa(o.contractAddress),
      result: fmtPct(o.unrealizedPct),
    });
  }
  for (const c of data.closedPositions ?? []) {
    byCa.set(c.contractAddress.toLowerCase(), {
      token: c.tokenSymbol ? `$${c.tokenSymbol}` : shortCa(c.contractAddress),
      result: fmtPct(c.realisedPct),
    });
  }
  return (data.recentReviews ?? []).slice(0, 24).map((r, i) => {
    const pos = byCa.get((r.contractAddress || "").toLowerCase());
    const handle = r.authorHandle
      ? r.authorHandle.startsWith("@")
        ? r.authorHandle
        : `@${r.authorHandle}`
      : "@author";
    return {
      key: `${r.postId || r.contractAddress || "review"}-${i}`,
      handle,
      token: pos?.token ?? shortCa(r.contractAddress),
      grade: r.grade,
      decision: r.decision,
      result: r.decision === "BUY" ? pos?.result ?? "—" : "—",
    };
  });
}

function Item({ entry }: { entry: TapeEntry }) {
  return (
    <span className={styles.tapeItem}>
      <b>{entry.handle}</b>
      <span style={{ color: "var(--blue)" }}>{entry.token}</span>
      <span style={{ color: GRADE_COLOR[entry.grade] }}>{entry.grade}</span>
      <span style={{ color: entry.decision === "BUY" ? "var(--green)" : "var(--dim)" }}>
        {entry.decision}
      </span>
      <span style={{ color: resultColor(entry.result) }}>{entry.result}</span>
    </span>
  );
}

export function VerdictTape({ data }: { data: DashboardData | null }) {
  const entries = buildTapeEntries(data);
  // Nothing reviewed yet → no tape at all, rather than a bar of fake calls.
  if (entries.length === 0) return null;

  // Repeat the real entries until the bar is comfortably full, then double the
  // whole run so the marquee's -50% loop has no visible seam.
  const filled: TapeEntry[] = [];
  while (filled.length < MIN_TAPE_ITEMS) filled.push(...entries);
  const loop = [...filled, ...filled];

  return (
    <div className={styles.tape}>
      <span className={styles.tapeTag}>
        <span className={styles.tapeDot} aria-hidden="true" />
        LIVE&nbsp;FEED
      </span>
      <div className={styles.tapeWrap}>
        <div className={styles.tapeTrack}>
          {loop.map((entry, i) => (
            <Item key={`${entry.key}-${i}`} entry={entry} />
          ))}
        </div>
      </div>
    </div>
  );
}
