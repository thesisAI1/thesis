"use client";

/**
 * The live ticker tape — a scrolling marquee of the freshest committee activity
 * (buys, take-profits, stops, lottery payouts, $THESIS buybacks). Mirrors the
 * legacy `#ticker-tape`.
 *
 * Seeded by the SSR dashboard payload, then refreshed by a light 15s poll of
 * /api/dashboard for `recentActivity` ONLY. (The SSE `/api/stream` carries
 * agent-review events — review:start, agent:step … — not these settlement
 * events, so it's the wrong source for the tape.) Hidden until at least one
 * event exists. Pauses and becomes a plain scroll-strip under reduced motion.
 */
import { useEffect, useState } from "react";
import type { ActivityItem, DashboardData } from "@/lib/api";
import styles from "./dashboard.module.css";

/** Match the positions poll cadence so the page makes one rhythm of requests. */
const POLL_MS = 15_000;
/** Past ~30 items the marquee just scrolls longer without adding signal. */
const MAX_ITEMS = 30;

/** Accent class per event kind — drives the leading dot colour. */
const KIND_CLASS: Record<ActivityItem["kind"], string> = {
  buy: styles.tkBuy,
  tp: styles.tkTp,
  sl: styles.tkSl,
  manual: styles.tkManual,
  aging: styles.tkAging,
  lottery: styles.tkLottery,
  burn: styles.tkBurn,
  skip: styles.tkSkip,
};

export function Ticker({ initial }: { initial: ActivityItem[] }) {
  const [items, setItems] = useState<ActivityItem[]>(initial);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const res = await fetch("/api/dashboard", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as DashboardData;
        if (!cancelled) setItems(data.recentActivity ?? []);
      } catch {
        // Transient blip — keep the last good snapshot rather than blanking.
      }
    };
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
    };
  }, []);

  if (items.length === 0) return null;
  const top = items.slice(0, MAX_ITEMS);

  // The track holds TWO identical runs; the marquee animates -50% so run B
  // lands exactly where run A began — a seamless loop with no visible gap.
  const run = (key: string) =>
    top.map((it, i) => (
      <span className={`${styles.tkItem} ${KIND_CLASS[it.kind] ?? ""}`} key={`${key}-${i}`}>
        {it.summary}
      </span>
    ));

  return (
    <div className={styles.ticker} aria-label="Live activity">
      <span className={styles.tkLabel}>
        <span className={styles.tkDot} aria-hidden="true" /> live
      </span>
      <div className={styles.tkTrackWrap}>
        <div className={styles.tkTrack}>
          {run("a")}
          {run("b")}
        </div>
      </div>
    </div>
  );
}
