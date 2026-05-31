/**
 * THESIS homepage (Direction-B terminal).
 *
 * Server Component: fetches the live dashboard once at request time and passes
 * it to The Record; a backend error degrades to a zero state rather than
 * failing the page. Everything else is static server markup plus a few
 * interactive/animated client children (verdict tape, count-ups, the live
 * Faculty Office, copy). Section order: hero · Faculty Office · record · faculty
 * · the 25% split · $THESIS strip · CTA.
 */
import { TopBar } from "@/components/shell/TopBar";
import { Footer } from "@/components/shell/Footer";
import { getDashboard, ThesisApiError, type DashboardData } from "@/lib/api";
import { VerdictTape } from "./_home/VerdictTape";
import { Hero } from "./_home/Hero";
import { FacultyOffice } from "./_home/FacultyOffice";
import { Record } from "./_home/Record";
import { Faculty } from "./_home/Faculty";
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

export default async function Home() {
  const dashboard = await loadDashboard();

  return (
    <>
      <TopBar />
      <VerdictTape />
      <main>
        <Hero />
        <FacultyOffice />
        <Record data={dashboard} />
        <Faculty />
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
