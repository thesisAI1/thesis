/**
 * Closing CTA (design `.cta-card`) — the "write a thesis worth funding" panel
 * with the amber top-edge, the submit primary, and a secondary link to the live
 * record (the dashboard).
 */
import Link from "next/link";
import { Reveal } from "./Reveal";

export function Cta() {
  return (
    <section id="submit" className="py-[30px]">
      <div className="mx-auto max-w-shell px-7">
        <Reveal>
          <div className="relative overflow-hidden rounded-lg border border-border-2 bg-[linear-gradient(180deg,#161d2b,#10141d)] px-10 py-[72px] text-center before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[linear-gradient(90deg,transparent,rgba(230,163,62,0.5),transparent)] before:content-['']">
            <h2 className="text-[clamp(34px,5vw,60px)] font-extrabold leading-[1.02] tracking-[-1.5px]">
              Write a thesis worth <span className="text-accent">funding.</span>
            </h2>
            <p className="mx-auto my-[18px] mb-[30px] max-w-[56ch] text-[16px] leading-[1.6] text-muted">
              Post it on X, tag the committee, paste the contract address. Earn an A or a B and the
              committee puts its own capital behind your conviction.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                href="/pitch"
                className="inline-flex items-center gap-[9px] rounded-md border border-transparent bg-[linear-gradient(160deg,#f0b455,#e09a2e)] px-[22px] py-[13px] text-[14.5px] font-semibold text-[#1a1305] shadow-primary transition-transform hover:-translate-y-px"
              >
                Submit a thesis
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-[9px] rounded-md border border-border-2 bg-panel-2 px-[22px] py-[13px] text-[14.5px] font-semibold text-text transition-colors hover:border-border-hi"
              >
                View the live record →
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
