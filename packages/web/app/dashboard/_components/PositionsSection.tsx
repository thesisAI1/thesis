"use client";

/**
 * Section 02 — Positions (mockup `#positions`). Client component: Open / History
 * tabs, plus a live refetch of the RELATIVE `/api/dashboard` every ~15s seeded
 * by the SSR snapshot. Real values only — no fabricated random walk; cells flash
 * green/red when an unrealised PnL actually changes between polls.
 *
 * `onRefresh` lets the page reset the "Updated Ns ago" ticker on each pull.
 */
import { useEffect, useRef, useState } from "react";
import type {
  ClosedPositionView,
  DashboardData,
  OpenPositionView,
} from "@/lib/api";
import { OpenPositionsTable } from "./OpenPositionsTable";
import { HistoryTable } from "./HistoryTable";
import styles from "./dashboard.module.css";

export interface PositionsSectionProps {
  initialOpen: OpenPositionView[];
  initialClosed: ClosedPositionView[];
  /** Bumped on every successful live refetch (drives the Updated ticker). */
  onRefresh?: () => void;
}

const POLL_MS = 15_000;
type Tab = "open" | "hist";

export function PositionsSection({
  initialOpen,
  initialClosed,
  onRefresh,
}: PositionsSectionProps) {
  const [tab, setTab] = useState<Tab>("open");
  const [open, setOpen] = useState<OpenPositionView[]>(initialOpen);
  const [closed, setClosed] = useState<ClosedPositionView[]>(initialClosed);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const poll = async () => {
      try {
        // Relative path → Next rewrite → backend (browser-side, no CORS).
        const res = await fetch("/api/dashboard", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as DashboardData;
        if (cancelled) return;
        setOpen(data.openPositions);
        setClosed(data.closedPositions);
        onRefreshRef.current?.();
      } catch {
        // transient network/backend blip — keep the last good snapshot
      }
    };

    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
    };
  }, []);

  return (
    <>
      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${tab === "open" ? styles.on : ""}`}
          onClick={() => setTab("open")}
        >
          Open <span className={styles.cnt}>{open.length}</span>
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === "hist" ? styles.on : ""}`}
          onClick={() => setTab("hist")}
        >
          History <span className={styles.cnt}>{closed.length}</span>
        </button>
      </div>

      {tab === "open" ? (
        <OpenPositionsTable positions={open} />
      ) : (
        <HistoryTable positions={closed} />
      )}
    </>
  );
}
