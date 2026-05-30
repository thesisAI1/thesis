/**
 * Faculty sigils.
 *
 * The five committee agents each have an outline sigil (1.7px stroke, 24×24,
 * drawn in currentColor) — ported verbatim from the design system's Sigils.jsx.
 * Sigil renders one inside a rounded-square chip tinted with the agent's colour
 * via color-mix, matching the Direction-B `.agent-sig` / `.mod-sig` treatment.
 */
import type { CSSProperties, ReactElement } from "react";

/** The five Faculty agents. */
export type AgentName = "registrar" | "auditor" | "dean" | "bursar" | "endowment";

/** Agent → brand colour. Mirrors the faculty palette in tokens.css. */
export const AGENT_COLOR: Record<AgentName, string> = {
  registrar: "var(--blue)", // vets the author
  auditor: "var(--accent)", // audits the token (amber)
  dean: "var(--purple)", // delivers the verdict
  bursar: "var(--green)", // executes the trade
  endowment: "var(--red)", // splits the profit
};

/** Display labels + one-line roles, for cards/legends that render a sigil. */
export const AGENT_META: Record<AgentName, { name: string; role: string }> = {
  registrar: { name: "The Registrar", role: "vets the author" },
  auditor: { name: "The Auditor", role: "audits the token" },
  dean: { name: "The Dean", role: "delivers the verdict" },
  bursar: { name: "The Bursar", role: "executes the trade" },
  endowment: { name: "The Endowment", role: "splits the profit" },
};

/** Exact SVG path geometry for each sigil (from Sigils.jsx). */
const SIGIL_PATHS: Record<AgentName, ReactElement> = {
  registrar: (
    <>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  auditor: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4.3-4.3" />
    </>
  ),
  dean: (
    <>
      <path d="M12 4v16M6 8h12M9 20h6" />
      <path d="M6 8 3 14a3 3 0 0 0 6 0Z" />
      <path d="M18 8l3 6a3 3 0 0 1-6 0Z" />
    </>
  ),
  bursar: (
    <>
      <path d="M3 16.5 9.5 10l4 4L21 6" />
      <path d="M15.5 6H21v5.5" />
    </>
  ),
  endowment: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17M3.5 12h17" />
    </>
  ),
};

export interface SigilProps {
  agent: AgentName;
  /** Chip edge length in px. Icon scales to ~55% of it. */
  size?: number;
  className?: string;
}

/** A faculty sigil in its tinted, rounded-square chip. */
export function Sigil({ agent, size = 46, className }: SigilProps) {
  const color = AGENT_COLOR[agent];
  // The design tints the chip with the agent colour: a 14% fill over panel-2
  // and a 40% border, with the glyph itself in the full colour.
  const style: CSSProperties = {
    width: size,
    height: size,
    color,
    background: `color-mix(in srgb, ${color} 14%, var(--panel-2))`,
    border: `1px solid color-mix(in srgb, ${color} 40%, var(--border))`,
  };
  const glyph = Math.round(size * 0.52);
  return (
    <span
      className={`inline-grid place-items-center rounded-md${className ? ` ${className}` : ""}`}
      style={style}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={glyph}
        height={glyph}
      >
        {SIGIL_PATHS[agent]}
      </svg>
    </span>
  );
}
