/**
 * Panel surface (design `.card`). A bordered, rounded panel; with `highlight`
 * it gets the signature 1px brushed top-edge (the `.card::before` gradient).
 */
import type { ReactNode } from "react";

export interface CardProps {
  children: ReactNode;
  /** Render the 1px brushed-metal top-edge highlight. */
  highlight?: boolean;
  className?: string;
}

const TOP_EDGE =
  "before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent)] before:content-['']";

export function Card({ children, highlight = false, className }: CardProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-border bg-panel${highlight ? ` ${TOP_EDGE}` : ""}${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}
