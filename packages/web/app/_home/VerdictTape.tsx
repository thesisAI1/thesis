"use client";

/**
 * The live verdict tape (design `.tape`): a paused-on-hover marquee of recent
 * committee calls — author · token · grade · BUY/SKIP · result. The track is
 * doubled so the -50% keyframe loops seamlessly. Static sample feed matching
 * the mockup; the real tape would hydrate from the review record.
 */
import styles from "./home.module.css";

interface TapeEntry {
  handle: string;
  token: string;
  grade: "A" | "B" | "C" | "D" | "F";
  decision: "BUY" | "SKIP";
  result: string;
}

const FEED: TapeEntry[] = [
  { handle: "@onchainmaxi", token: "$FORGE", grade: "A", decision: "BUY", result: "+200%" },
  { handle: "@basedanon", token: "$MOCHI", grade: "D", decision: "SKIP", result: "—" },
  { handle: "@degenscholar", token: "$ROUTE", grade: "A", decision: "BUY", result: "+67%" },
  { handle: "@toshiarmy", token: "$TOSHI", grade: "B", decision: "BUY", result: "+71%" },
  { handle: "@floorsweeper", token: "$PEPE", grade: "C", decision: "SKIP", result: "—" },
  { handle: "@yieldfarmer", token: "$AERO", grade: "B", decision: "BUY", result: "+84%" },
  { handle: "@catpilled", token: "$KEYCAT", grade: "B", decision: "BUY", result: "-4%" },
];

const GRADE_COLOR: Record<TapeEntry["grade"], string> = {
  A: "var(--green)",
  B: "var(--blue)",
  C: "var(--accent)",
  D: "var(--red)",
  F: "var(--red)",
};

function resultColor(result: string): string {
  if (result === "—") return "var(--muted)";
  return result.startsWith("+") ? "var(--green)" : "var(--red)";
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

export function VerdictTape() {
  const loop = [...FEED, ...FEED];
  return (
    <div className={styles.tape}>
      <span className={styles.tapeTag}>
        <span className={styles.tapeDot} aria-hidden="true" />
        LIVE&nbsp;FEED
      </span>
      <div className={styles.tapeWrap}>
        <div className={styles.tapeTrack}>
          {loop.map((entry, i) => (
            <Item key={`${entry.handle}-${i}`} entry={entry} />
          ))}
        </div>
      </div>
    </div>
  );
}
