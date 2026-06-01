/**
 * THESIS homepage (Direction-B terminal).
 *
 * Server Component: fetches the live dashboard + leaderboard once at request
 * time and feeds them to the Hero's live stat row and the Top Authors podium; a
 * backend error degrades to a zero/empty state rather than failing the page.
 * Section order: hero · Faculty Office · manifesto · top authors · $THESIS
 * (25% split + token strip) · CTA.
 */
import { TopBar } from "@/components/shell/TopBar";
import { Footer } from "@/components/shell/Footer";
import {
  getDashboard,
  getLeaderboard,
  ThesisApiError,
  type DashboardData,
  type LeaderboardEntry,
} from "@/lib/api";
import { VerdictTape } from "./_home/VerdictTape";
import { Hero } from "./_home/Hero";
import { FacultyOffice } from "./_home/FacultyOffice";
import { Manifesto } from "./_home/Manifesto";
import { TopAuthors } from "./_home/TopAuthors";
import { Split } from "./_home/Split";
import { TokenStrip } from "./_home/TokenStrip";
import { Cta } from "./_home/Cta";

/** Fetch the dashboard, degrading to null (zero state) on any backend error. */
async function loadDashboard(): Promise<DashboardData | null> {
  try {
    return await getDashboard();
  } catch (error) {
    if (error instanceof ThesisApiError) return null;
    throw error;
  }
}

/** Fetch the top three authors for the homepage podium; degrade to []. */
async function loadTopAuthors(): Promise<LeaderboardEntry[]> {
  try {
    return (await getLeaderboard()).leaderboard.slice(0, 3);
  } catch (error) {
    if (error instanceof ThesisApiError) return [];
    throw error;
  }
}

export default async function Home() {
  const [dashboard, topAuthors] = await Promise.all([loadDashboard(), loadTopAuthors()]);

  return (
    <>
      <TopBar />
      <VerdictTape data={dashboard} />
      <main>
        <Hero data={dashboard} />
        <FacultyOffice />
        <Manifesto />
        <TopAuthors entries={topAuthors} />
        <section id="token" className="py-[30px]">
          <div className="mx-auto max-w-shell px-7">
            <Split />
            <TokenStrip />
          </div>
        </section>
        <Cta />
      </main>
      <Footer />
    </>
  );
}
