/**
 * Manifesto — the "why this is different" beat that sits directly below the
 * Faculty Office. The committee risks its own capital; the author risks nothing
 * and keeps a quarter of every win. Pure server markup with reveal-on-scroll.
 */
import Link from "next/link";
import { Reveal } from "./Reveal";

export function Manifesto() {
  return (
    <section id="why" className="border-y border-border/60 py-[52px]">
      <div className="mx-auto max-w-shell px-7">
        <Reveal>
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[1.6px] text-accent">
            No capital · No risk
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="max-w-[20ch] text-[clamp(30px,4.6vw,54px)] font-extrabold leading-[1.03] tracking-[-1.8px]">
            The only way to earn <span className="text-accent">risk-free.</span>
          </h2>
        </Reveal>
        <Reveal delay={170}>
          <p className="mt-6 max-w-[62ch] text-[17.5px] leading-[1.65] text-muted">
            <b className="font-semibold text-text">Nobody has built this before.</b> You don&apos;t
            invest a cent of your own — you bring the thesis, the committee brings the money. Tag a
            Base token worth backing, and five agents put real ETH behind your call. Win, and{" "}
            <b className="font-semibold text-text">25% of the profit is yours.</b> The sharper your
            eye, the more you make. Good hunters get paid.
          </p>
        </Reveal>
        <Reveal delay={250}>
          <Link
            href="/pitch"
            className="mt-8 inline-flex items-center gap-[9px] rounded-md border border-border-2 bg-panel-2 px-[22px] py-[13px] text-[14.5px] font-semibold text-text transition-colors hover:border-border-hi"
          >
            Start hunting →
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
