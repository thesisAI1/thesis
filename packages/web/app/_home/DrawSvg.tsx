"use client";

/**
 * SVG line-draw — the React port of motion.js's [data-draw] handler.
 *
 * On mount it measures every descendant marked `data-draw`, sets a full
 * stroke-dasharray + offset (so the stroke starts hidden), then releases the
 * offset to 0 when the container scrolls into view — tracing the path. Reduced
 * motion paints the stroke complete immediately. The container is a plain
 * wrapper so callers pass the raw <svg> as children.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { useReducedMotion } from "./useReducedMotion";
import styles from "./home.module.css";

export interface DrawSvgProps {
  children: ReactNode;
  className?: string;
  /** Delay before the draw releases, in ms. */
  delay?: number;
  ariaHidden?: boolean;
}

export function DrawSvg({ children, className, delay = 0, ariaHidden }: DrawSvgProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const paths = root.querySelectorAll<SVGGeometryElement>("[data-draw]");
    if (!paths.length) return;

    paths.forEach((path) => {
      let length = 0;
      try {
        length = path.getTotalLength();
      } catch {
        return;
      }
      path.style.strokeDasharray = String(length);
      path.style.strokeDashoffset = reduced ? "0" : String(length);
      path.classList.add(styles.drawLine);
    });

    if (reduced) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          window.setTimeout(() => {
            paths.forEach((path) => {
              path.style.strokeDashoffset = "0";
            });
          }, delay);
          io.unobserve(entry.target);
        }
      },
      { threshold: 0.4 },
    );
    io.observe(root);
    return () => io.disconnect();
  }, [delay, reduced]);

  return (
    <div ref={ref} className={className} aria-hidden={ariaHidden}>
      {children}
    </div>
  );
}
