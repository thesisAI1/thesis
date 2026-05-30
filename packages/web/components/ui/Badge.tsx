/**
 * Grade badge (design `.badge` + `.grade-*`). A small mono chip coloured by
 * letter grade: A green, B blue, C amber, D/F red (F slightly stronger).
 */
import type { Grade } from "@thesis/shared";

/** Per-grade chip styles, mirroring the design's .grade-A … .grade-F rules. */
const GRADE_STYLE: Record<Grade, { fg: string; bg: string }> = {
  A: { fg: "var(--green)", bg: "rgba(63,185,132,.16)" },
  B: { fg: "var(--blue)", bg: "rgba(79,157,222,.16)" },
  C: { fg: "var(--accent)", bg: "rgba(230,163,62,.16)" },
  D: { fg: "var(--red)", bg: "rgba(224,101,62,.16)" },
  F: { fg: "var(--red)", bg: "rgba(224,101,62,.22)" },
};

export interface BadgeProps {
  grade: Grade;
  className?: string;
}

export function Badge({ grade, className }: BadgeProps) {
  const { fg, bg } = GRADE_STYLE[grade];
  return (
    <span
      className={`inline-block rounded-xs px-2 py-[2px] font-mono text-[11px] font-bold${className ? ` ${className}` : ""}`}
      style={{ color: fg, background: bg }}
    >
      {grade}
    </span>
  );
}
