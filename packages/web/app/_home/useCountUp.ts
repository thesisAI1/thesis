"use client";

/**
 * Count-up — the React port of motion.js's animateCount. Eases a number from 0
 * to `target` (cubic ease-out) the first time the element scrolls into view,
 * with optional grouping, decimals, prefix and suffix. Reduced motion jumps
 * straight to the formatted target.
 */
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

export interface CountUpOptions {
  target: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Thousands separators on the integer part. */
  group?: boolean;
  durationMs?: number;
}

function format(value: number, opts: CountUpOptions): string {
  const { decimals = 0, prefix = "", suffix = "", group = false } = opts;
  let body = value.toFixed(decimals);
  if (group) {
    const [int, frac] = body.split(".");
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    body = frac ? `${grouped}.${frac}` : grouped;
  }
  return `${prefix}${body}${suffix}`;
}

export interface UseCountUpResult<T extends HTMLElement> {
  ref: React.RefObject<T | null>;
  text: string;
}

export function useCountUp<T extends HTMLElement = HTMLSpanElement>(
  opts: CountUpOptions,
): UseCountUpResult<T> {
  const ref = useRef<T>(null);
  const reduced = useReducedMotion();
  const [text, setText] = useState(() => format(0, opts));
  // Capture options once per render so the rAF loop reads a stable target.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const settings = optsRef.current;

    if (reduced) {
      setText(format(settings.target, settings));
      return;
    }

    let raf = 0;
    let started = false;
    const duration = settings.durationMs ?? 1400;

    const run = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        setText(format(settings.target * eased, settings));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !started) {
            started = true;
            run();
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced, opts.target]);

  return { ref, text };
}
