"use client";

/**
 * Scroll-reveal — the React port of motion.js's [data-reveal] behaviour.
 *
 * An element is "armed" (hidden, nudged 26px down) only when it loads BELOW the
 * fold; above-the-fold content paints immediately (no flash). On intersection
 * it gains `shown` after an optional delay, animating opacity + transform only.
 * Reduced motion never arms (resting state stays visible).
 *
 * Returns a ref to attach plus the class string to apply (from home.module.css,
 * passed in so the hook stays style-agnostic).
 */
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

const FOLD_RATIO = 0.88;

export interface RevealClassNames {
  base: string;
  armed: string;
  shown: string;
  reduce: string;
}

export interface UseRevealResult<T extends HTMLElement> {
  ref: React.RefObject<T | null>;
  className: string;
}

export function useReveal<T extends HTMLElement = HTMLDivElement>(
  classes: RevealClassNames,
  delayMs = 0,
): UseRevealResult<T> {
  const ref = useRef<T>(null);
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;

    // Arm only if below the fold at mount; otherwise paint visible.
    const belowFold = el.getBoundingClientRect().top > window.innerHeight * FOLD_RATIO;
    if (!belowFold) return;
    setArmed(true);

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          window.setTimeout(() => setShown(true), delayMs);
          io.unobserve(entry.target);
        }
      },
      { threshold: 0.16, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delayMs, reduced]);

  const className = [
    classes.base,
    armed ? classes.armed : "",
    shown ? classes.shown : "",
    reduced ? classes.reduce : "",
  ]
    .filter(Boolean)
    .join(" ");

  return { ref, className };
}
