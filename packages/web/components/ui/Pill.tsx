/**
 * Mono status pill (design `.pill`). The "live" tone tints green and prepends
 * a pulsing dot — used for the "committee in session" indicator.
 */
import type { ReactNode } from "react";

export type PillTone = "default" | "live";

export interface PillProps {
  children: ReactNode;
  tone?: PillTone;
  className?: string;
}

export function Pill({ children, tone = "default", className }: PillProps) {
  const live = tone === "live";
  const toneClasses = live
    ? "text-green border-[color-mix(in_srgb,var(--green)_28%,transparent)] bg-[color-mix(in_srgb,var(--green)_8%,transparent)]"
    : "text-muted border-border bg-panel";
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-pill border px-[13px] py-[6px] font-mono text-[11.5px] ${toneClasses}${className ? ` ${className}` : ""}`}
    >
      {live ? (
        <span
          className="h-[6px] w-[6px] rounded-pill bg-green shadow-[0_0_8px_var(--green)]"
          aria-hidden="true"
        />
      ) : null}
      {children}
    </span>
  );
}
