/**
 * KPI stat card (design `.stat-card` / `.stat-card.is-hero`). A label, a large
 * tabular value, an optional sub-line, and an optional leading icon. The hero
 * variant is larger and gets the amber-tinted top edge.
 */
import type { CSSProperties, ReactNode } from "react";

export type StatCardVariant = "hero" | "secondary";

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** Small leading glyph rendered before the label. */
  icon?: ReactNode;
  variant?: StatCardVariant;
  /** Override the value colour (e.g. var(--green) for positive PnL). */
  valueColor?: string;
  className?: string;
}

const TOP_EDGE_BASE =
  "before:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent)]";
const TOP_EDGE_HERO =
  "before:bg-[linear-gradient(90deg,transparent,rgba(230,163,62,0.4),transparent)]";

export function StatCard({
  label,
  value,
  sub,
  icon,
  variant = "secondary",
  valueColor,
  className,
}: StatCardProps) {
  const hero = variant === "hero";
  const surface = hero
    ? "border-border-2 bg-[linear-gradient(180deg,#1a2030_0%,var(--panel)_100%)] px-5 pb-4 pt-[18px]"
    : "border-border bg-[linear-gradient(180deg,#131825_0%,#0e1219_100%)] px-4 pb-[14px] pt-4";
  const topEdge = hero ? TOP_EDGE_HERO : TOP_EDGE_BASE;
  const valueStyle: CSSProperties | undefined = valueColor
    ? { color: valueColor }
    : undefined;
  return (
    <div
      className={`relative overflow-hidden rounded-lg border before:absolute before:inset-x-0 before:top-0 before:h-px before:content-[''] ${surface} ${topEdge}${className ? ` ${className}` : ""}`}
    >
      <div className="mb-[10px] flex items-center gap-2">
        {icon ? (
          <span
            className={`inline-flex h-[14px] w-[14px] items-center justify-center ${hero ? "text-accent" : "text-muted"}`}
          >
            {icon}
          </span>
        ) : null}
        <span
          className={`font-mono uppercase text-muted ${hero ? "text-[10.5px] tracking-[1.8px]" : "text-[10px] tracking-[1.6px]"}`}
        >
          {label}
        </span>
      </div>
      <div
        className={`font-bold leading-none tabular-nums ${hero ? "mb-[6px] text-[34px] tracking-[-0.7px]" : "text-[21px] tracking-[-0.3px]"}`}
        style={valueStyle}
      >
        {value}
      </div>
      {sub ? (
        <div
          className={`mt-[6px] leading-[1.45] text-muted ${hero ? "text-[11.5px]" : "text-[11px]"}`}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}
