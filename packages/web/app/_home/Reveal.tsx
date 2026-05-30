"use client";

/**
 * Wraps children in a scroll-revealed block (transform-only entrance, armed
 * only below the fold, reduced-motion safe). Thin client shell over useReveal
 * so Server Components can compose reveals declaratively.
 */
import type { ReactNode } from "react";
import { useReveal } from "./useReveal";
import styles from "./home.module.css";

const REVEAL_CLASSES = {
  base: styles.reveal,
  armed: styles.armed,
  shown: styles.shown,
  reduce: styles.reduce,
};

export interface RevealProps {
  children: ReactNode;
  /** Reveal delay in ms (matches the design's data-reveal-delay). */
  delay?: number;
  className?: string;
}

export function Reveal({ children, delay = 0, className }: RevealProps) {
  const { ref, className: revealClass } = useReveal<HTMLDivElement>(REVEAL_CLASSES, delay);
  return (
    <div ref={ref} className={`${revealClass}${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}
