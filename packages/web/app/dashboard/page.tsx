/**
 * THESIS — Live Record (the dashboard). The site's primary page: a live,
 * on-chain transparency record of the committee's trading.
 *
 * Server Component. Fetches the dashboard + leaderboard payloads at request time
 * (15s-revalidated to match the upstream cache) and hands the data to the live
 * client islands. A backend outage degrades to a calm empty state rather than a
 * crash. Built pixel-faithfully from the Direction-B `dashboard.html` mockup.
 */
import type { Metadata } from "next";
import { Suspense } from "react";
import { TopBar } from "@/components/shell/TopBar";
import { Footer } from "@/components/shell/Footer";
import {
  getDashboard,
  getLeaderboard,
  ThesisApiError,
  type CountersSummary,
  type DashboardData,
  type LeaderboardData,
  type RecentWinsSummary,
} from "@/lib/api";
import { ArchiveEntrance } from "./_components/ArchiveEntrance";
import { ArchiveMasthead } from "./_components/ArchiveMasthead";
import { BentoOverview } from "./_components/BentoOverview";
import { DecisionsSection } from "./_components/DecisionsSection";
import { DistributionSplit } from "./_components/DistributionSplit";
import { DrawerTabs } from "./_components/DrawerTabs";
import { FunnelLine } from "./_components/FunnelLine";
import { Leaderboard } from "./_components/Leaderboard";
import { LiveDashboard } from "./_components/LiveDashboard";
import { RecentWins } from "./_components/RecentWins";
import { Ticker } from "./_components/Ticker";

export const metadata: Metadata = {
  title: "THESIS — The Archive",
  description:
    "The committee's live trading record: open positions, closed trades, every graded thesis, and the authors paid the most — on-chain and verifiable.",
};

/** The backend sends `null` for the portfolio *value* fields when there are no
 *  open positions to value, even though the contract types them as `number`.
 *  Coerce to 0 at the boundary so the KPI formatters (`.toFixed`, etc.) never
 *  crash the page. */
function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Defaults for the fields a newer payload carries but an OLDER deployed backend
 *  may omit (deploy skew). Coercing them here, at the data boundary, keeps the
 *  new widgets free of null-guards and lets a stale backend render an empty
 *  widget instead of throwing. */
const EMPTY_COUNTERS: CountersSummary = {
  authorsTotalEth: 0,
  buybackTotalEth: 0,
  portfolioTotalEth: 0,
  winRate7d: 0,
  winRate7dCount: 0,
};
const EMPTY_RECENT_WINS: RecentWinsSummary = {
  count24h: 0,
  profitEth24h: 0,
  closedCount24h: 0,
};

function withSafeDashboard(d: DashboardData): DashboardData {
  const p = d.portfolio;
  return {
    ...d,
    portfolio: {
      ...p,
      openPositionsValueEth: num(p.openPositionsValueEth),
      totalPortfolioValueEth: num(p.totalPortfolioValueEth),
      openPositionsValueUsd: num(p.openPositionsValueUsd),
      totalPortfolioValueUsd: num(p.totalPortfolioValueUsd),
    },
    counters: d.counters ?? EMPTY_COUNTERS,
    recentWins: d.recentWins ?? EMPTY_RECENT_WINS,
    authorStats: d.authorStats ?? {},
    recentActivity: d.recentActivity ?? [],
  };
}

/** Fetch both payloads, tolerating a downed backend by returning nulls so the
 *  page can render its empty state instead of throwing. */
async function loadData(): Promise<{
  dashboard: DashboardData | null;
  leaderboard: LeaderboardData | null;
}> {
  const [dashboard, leaderboard] = await Promise.all([
    getDashboard().catch((err: unknown) => {
      if (err instanceof ThesisApiError) return null;
      throw err;
    }),
    getLeaderboard().catch((err: unknown) => {
      if (err instanceof ThesisApiError) return null;
      throw err;
    }),
  ]);
  return { dashboard: dashboard ? withSafeDashboard(dashboard) : null, leaderboard };
}

function EmptyState() {
  return (
    <main className="mx-auto max-w-shell px-6 py-[90px]">
      <p className="t-section-tag">THE ARCHIVE</p>
      <h1 className="t-h2 mt-3">The archive is warming up.</h1>
      <p className="t-lede mt-4 max-w-xl">
        The committee&apos;s data feed is unreachable right now. Positions,
        decisions and the author leaderboard appear here the moment it&apos;s
        back — every figure on-chain and verifiable.
      </p>
    </main>
  );
}

export default async function DashboardPage() {
  const { dashboard, leaderboard } = await loadData();
  // One server-stamped clock, threaded into the client components that render
  // relative times (timeAgo). Using the SAME `now` on the SSR pass and the
  // client hydration keeps their output identical — no hydration mismatch.
  const now = Date.now();

  return (
    <>
      {/* The dive overlay — plays only when arriving via the office Archive door.
          Suspense boundary required: ArchiveEntrance reads useSearchParams(). */}
      <Suspense fallback={null}>
        <ArchiveEntrance />
      </Suspense>
      <TopBar />
      {dashboard ? (
        <main className="mx-auto max-w-shell px-6 pb-[90px]">
          <ArchiveMasthead />
          <DrawerTabs />
          {/* Live activity tape — a transient marquee of the freshest settlement
              events, seeded by the SSR payload and polled client-side. */}
          <Ticker initial={dashboard.recentActivity} />
          <LiveDashboard
            mode={dashboard.mode}
            portfolio={dashboard.portfolio}
            initialOpen={dashboard.openPositions}
            initialClosed={dashboard.closedPositions}
            authorStats={dashboard.authorStats}
            now={now}
            overview={
              <>
                <BentoOverview
                  portfolio={dashboard.portfolio}
                  reviews={dashboard.reviews}
                  distributions={dashboard.distributions}
                  closedPositions={dashboard.closedPositions}
                />
                <RecentWins
                  recentWins={dashboard.recentWins}
                  counters={dashboard.counters}
                />
                <DistributionSplit distributions={dashboard.distributions} />
                <FunnelLine funnel={dashboard.funnel} />
              </>
            }
            decisions={<DecisionsSection reviews={dashboard.recentReviews} now={now} />}
            leaderboard={<Leaderboard entries={leaderboard?.leaderboard ?? []} />}
          />
        </main>
      ) : (
        <EmptyState />
      )}
      <Footer />
    </>
  );
}
