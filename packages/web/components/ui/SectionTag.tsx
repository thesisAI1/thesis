/**
 * The mono eyebrow + trailing hairline rule (design `.section-tag`). Renders
 * an uppercase amber mono label followed by a 1px line that fills the row.
 */
import type { ReactNode } from "react";

export interface SectionTagProps {
  children: ReactNode;
  className?: string;
}

export function SectionTag({ children, className }: SectionTagProps) {
  return (
    <div className={`flex items-center gap-3${className ? ` ${className}` : ""}`}>
      <span className="t-section-tag whitespace-nowrap">{children}</span>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}
