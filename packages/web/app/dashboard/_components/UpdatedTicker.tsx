"use client";

/**
 * The "Updated Ns ago" status pill (mockup `#updated`). Counts seconds since the
 * last data refresh; `resetKey` bumps whenever the live positions component
 * pulls fresh data, snapping the counter back to 0. Text-only — no transforms,
 * so it's inert under prefers-reduced-motion.
 */
import { useEffect, useState } from "react";

export interface UpdatedTickerProps {
  /** Changes whenever fresh data arrives; resets the counter to 0. */
  resetKey: number;
}

export function UpdatedTicker({ resetKey }: UpdatedTickerProps) {
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    setSecs(0);
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [resetKey]);

  return <>Updated {secs}s ago</>;
}
