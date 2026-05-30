/**
 * THESIS — The Faculty Office.
 *
 * A dedicated, always-on 2D sim of the committee at work: a room per agent who
 * reviews at their desk, walks the report to the Dean, and hands the funded
 * trade down to the Bursar and Endowment. The scene is driven by the live SSE
 * stream and auto-loops scripted reviews when the stream is idle.
 *
 * Server shell only — the <Office> sim is the client island.
 */
import type { Metadata } from "next";
import { TopBar } from "@/components/shell/TopBar";
import { Footer } from "@/components/shell/Footer";
import { SectionTag } from "@/components/ui/SectionTag";
import { Office } from "./Office";

export const metadata: Metadata = {
  title: "THESIS — The Faculty Office",
  description:
    "Watch the committee work in real time: the Registrar and Auditor vet a thesis at their desks, walk it to the Dean for a grade, and the Bursar trades it while the Endowment pays the author 25%.",
};

export default function FacultyPage() {
  return (
    <>
      <TopBar />

      <main className="mx-auto max-w-shell px-7 pb-[90px]">
        <section className="pt-[42px]">
          <SectionTag>The Faculty · Live</SectionTag>
          <h1 className="mt-[18px] mb-3 text-[clamp(32px,4.6vw,46px)] font-extrabold leading-[1.05] tracking-[-1.4px]">
            The committee at work.
          </h1>
          <p className="max-w-[66ch] text-[16.5px] leading-[1.6] text-muted">
            Five agents, five offices. Watch a thesis arrive, get vetted at two desks at once, walk
            to the Dean for a grade, and — if it earns an A or B — get handed to the Bursar to trade
            and the Endowment to pay the author. This plays live; when the committee is quiet it
            replays recent reviews.
          </p>
        </section>

        <Office />
      </main>

      <Footer />
    </>
  );
}
