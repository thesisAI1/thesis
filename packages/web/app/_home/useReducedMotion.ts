"use client";

/**
 * Reports the user's reduced-motion preference, reacting to live changes.
 * Returns `true` until mount (SSR-safe default) only if the media query
 * matches; before mount it reports `false` so first paint matches the armed
 * client behaviour, then syncs on the effect.
 */
import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(QUERY);
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
