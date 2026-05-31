/**
 * The Faculty Office on the homepage.
 *
 * The 2D pixel-art committee sim — agents sit at their desks and review a thesis
 * in real time — that replaced both the static Pipeline and the card-based
 * Faculty Room. Wraps the shared <Office> client island (also rendered on
 * /faculty) in the homepage's section frame.
 */
import { SectionHead } from "./SectionHead";
import { Office } from "@/app/faculty/Office";

export function FacultyOffice() {
  return (
    <section id="office" className="py-[30px]">
      <div className="mx-auto max-w-shell px-7">
        <SectionHead index="01" title="The Faculty Office" meta="THE COMMITTEE · LIVE" />
        <Office />
      </div>
    </section>
  );
}
