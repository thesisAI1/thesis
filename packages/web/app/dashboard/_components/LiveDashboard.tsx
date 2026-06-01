"use client";

/**
 * Client orchestrator that shares the live-refresh clock between the status
 * ticker and the Positions section. The server-rendered sections (bento,
 * decisions, leaderboard) are passed through as slots so they stay on the
 * server — only the status pill and the positions table are interactive.
 *
 * Layout mirrors the mockup ordering:
 *   status pills → §01 overview (slot) → §02 positions (live) →
 *   §03 decisions (slot) → §04 leaderboard (slot)
 */
import { Fragment, useCallback, useState, type ReactNode } from "react";
import type {
  AuthorStatsMap,
  ClosedPositionView,
  OpenPositionView,
  PortfolioSummary,
} from "@/lib/api";
import { Pill } from "@/components/ui/Pill";
import { PositionsSection } from "./PositionsSection";
import { UpdatedTicker } from "./UpdatedTicker";
import { truncate } from "./format";
import styles from "./dashboard.module.css";

/** The trading wallet is the Base (EVM) account, so its on-chain record lives on
 *  BaseScan. Mirrors the legacy "Trading wallet on BaseScan ↗" link. */
function baseScanAddress(address: string): string {
  return `https://basescan.org/address/${encodeURIComponent(address)}`;
}

export interface LiveDashboardProps {
  mode: string;
  portfolio: PortfolioSummary;
  initialOpen: OpenPositionView[];
  initialClosed: ClosedPositionView[];
  /** Per-author win/total stats, keyed by lowercased handle. */
  authorStats: AuthorStatsMap;
  /** Server-stamped clock for relative times, so SSR and client hydration agree. */
  now: number;
  /** §01 overview bento (server-rendered). */
  overview: ReactNode;
  /** §03 decision log (client island, server-passed). */
  decisions: ReactNode;
  /** §04 leaderboard (server-rendered). */
  leaderboard: ReactNode;
}

function SectionHead({
  idx,
  title,
  meta,
  id,
}: {
  idx: string;
  title: string;
  meta: string;
  id: string;
}) {
  return (
    <div className={styles.secHead} id={id}>
      <span className={styles.secIdx}>{idx}</span>
      <span className={styles.secTitle}>{title}</span>
      <span className={styles.secMeta}>{meta}</span>
    </div>
  );
}

export function LiveDashboard({
  mode,
  portfolio,
  initialOpen,
  initialClosed,
  authorStats,
  now,
  overview,
  decisions,
  leaderboard,
}: LiveDashboardProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const onRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <>
      <div className={styles.status}>
        <Pill tone="live">Live · committee in session</Pill>
        <Pill>
          Mode&nbsp;&nbsp;<b style={{ color: "var(--text)" }}>{mode}</b>
        </Pill>
        <Pill>
          Wallet&nbsp;&nbsp;
          <a
            className={styles.walletLink}
            href={baseScanAddress(portfolio.walletAddress)}
            target="_blank"
            rel="noopener noreferrer"
            title="Trading wallet on BaseScan"
          >
            {truncate(portfolio.walletAddress)} ↗
          </a>
        </Pill>
        <Pill className={styles.statusRight}>
          <UpdatedTicker resetKey={refreshKey} />
        </Pill>
      </div>

      <section>
        <SectionHead id="overview" idx="01" title="Overview" meta="FROM THE TRADING WALLET" />
        <Fragment key="overview">{overview}</Fragment>
      </section>

      <section>
        <SectionHead id="positions" idx="02" title="Positions" meta="LIVE · OPEN & CLOSED" />
        <PositionsSection
          initialOpen={initialOpen}
          initialClosed={initialClosed}
          initialAuthorStats={authorStats}
          now={now}
          onRefresh={onRefresh}
        />
      </section>

      <section>
        <SectionHead id="decisions" idx="03" title="Decision Log" meta="EVERY GRADED THESIS" />
        <Fragment key="decisions">{decisions}</Fragment>
      </section>

      <section>
        <SectionHead
          id="leaderboard"
          idx="04"
          title="Author Leaderboard"
          meta="PAID THE MOST · 25% AUTHOR SHARE"
        />
        <Fragment key="leaderboard">{leaderboard}</Fragment>
      </section>
    </>
  );
}
