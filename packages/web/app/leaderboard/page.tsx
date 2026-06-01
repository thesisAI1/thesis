/**
 * The Author Leaderboard page.
 *
 * Server Component: fetches /api/leaderboard at request time and renders the
 * full ranking through <LeaderboardTable> (paginated 10/page, scroll-capped).
 * A backend error degrades to an empty state rather than failing the page.
 */
import type { Metadata } from "next";
import { TopBar } from "@/components/shell/TopBar";
import { Footer } from "@/components/shell/Footer";
import { SectionTag } from "@/components/ui/SectionTag";
import { getLeaderboard, ThesisApiError, type LeaderboardData } from "@/lib/api";
import { LeaderboardPodium } from "./LeaderboardPodium";
import { LeaderboardTable } from "./LeaderboardTable";

export const metadata: Metadata = {
  title: "THESIS — Author Leaderboard",
  description:
    "Every funded author ranked by realised author share — the 25% of each winning trade paid back to the thesis author.",
};

/** Fetch the leaderboard, degrading to null (empty state) on any backend error. */
async function loadLeaderboard(): Promise<LeaderboardData | null> {
  try {
    return await getLeaderboard();
  } catch (error) {
    if (error instanceof ThesisApiError) return null;
    throw error;
  }
}

export default async function LeaderboardPage() {
  const data = await loadLeaderboard();
  const entries = data?.leaderboard ?? [];

  return (
    <>
      <TopBar />

      <main className="mx-auto max-w-shell px-7 pb-[90px]">
        <section className="pt-[42px]">
          <SectionTag>The Leaderboard · Live</SectionTag>
          <h1 className="mt-[18px] mb-3 text-[clamp(32px,4.6vw,46px)] font-extrabold leading-[1.05] tracking-[-1.4px]">
            The author leaderboard.
          </h1>
          <p className="max-w-[66ch] text-[16.5px] leading-[1.6] text-muted">
            Every funded author, ranked by the ETH paid back to them — 25% of every winning trade goes
            to the author who called it.
            {data ? ` ${data.totalAuthors} author${data.totalAuthors === 1 ? "" : "s"} so far.` : ""}
          </p>
        </section>

        <LeaderboardPodium entries={entries} />

        <div className="mt-[26px]">
          <LeaderboardTable entries={entries} />
        </div>
      </main>

      <Footer />
    </>
  );
}
