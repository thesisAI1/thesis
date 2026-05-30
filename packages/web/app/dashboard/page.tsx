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
import { TopBar } from "@/components/shell/TopBar";
import { Footer } from "@/components/shell/Footer";
import {
  getDashboard,
  getLeaderboard,
  ThesisApiError,
  type DashboardData,
  type LeaderboardData,
} from "@/lib/api";
import { BentoOverview } from "./_components/BentoOverview";
import { DecisionsSection } from "./_components/DecisionsSection";
import { Leaderboard } from "./_components/Leaderboard";
import { LiveDashboard } from "./_components/LiveDashboard";

export const metadata: Metadata = {
  title: "THESIS — Live Record",
  description:
    "The committee's live trading record: open positions, closed trades, every graded thesis, and the authors paid the most — on-chain and verifiable.",
};

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
  return { dashboard, leaderboard };
}

function EmptyState() {
  return (
    <main className="mx-auto max-w-shell px-6 py-[90px]">
      <p className="t-section-tag">LIVE RECORD</p>
      <h1 className="t-h2 mt-3">The record is warming up.</h1>
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

  return (
    <>
      <TopBar variant="dashboard" />
      {dashboard ? (
        <main className="mx-auto max-w-shell px-6 pb-[90px]">
          <LiveDashboard
            mode={dashboard.mode}
            portfolio={dashboard.portfolio}
            initialOpen={dashboard.openPositions}
            initialClosed={dashboard.closedPositions}
            overview={
              <BentoOverview
                portfolio={dashboard.portfolio}
                reviews={dashboard.reviews}
                distributions={dashboard.distributions}
                closedPositions={dashboard.closedPositions}
              />
            }
            decisions={<DecisionsSection reviews={dashboard.recentReviews} />}
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
