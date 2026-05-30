/**
 * Hero (design `.hero`): the eyebrow, the headline, the lede, the two CTAs, the
 * proof-stat row, and the glowing wireframe theta with five orbiting faculty
 * dots. Reveal + count-up + line-draw are handled by the client children;
 * everything else is static server markup.
 */
import Link from "next/link";
import { Reveal } from "./Reveal";
import { CountUp } from "./CountUp";
import { HeroVideo } from "./HeroVideo";

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      {/* Video stage: a 16:9 block on mobile (the whole theta scene stays visible),
          a full-bleed background on desktop (the headline overlays it). */}
      <div className="relative aspect-[16/9] w-full md:absolute md:inset-0 md:aspect-auto md:h-full">
        <HeroVideo />
        {/* Orbit anchor for OrbField — the point the five faculty orbs circle. */}
        <span
          data-orb-anchor="theta"
          className="pointer-events-none absolute left-[67%] top-[47%] md:left-[55%] md:top-[45%]"
          aria-hidden="true"
        />
      </div>

      <div className="relative z-[2] mx-auto flex w-full max-w-shell flex-col justify-center px-7 pb-16 pt-10 md:min-h-[88vh] md:py-24">
        <Reveal>
          <span className="mb-[26px] inline-flex items-center gap-2 rounded-pill border border-[color-mix(in_srgb,var(--green)_28%,transparent)] bg-[color-mix(in_srgb,var(--green)_8%,transparent)] px-[13px] py-[6px]">
            <span
              className="h-[6px] w-[6px] rounded-pill bg-green shadow-[0_0_0_3px_color-mix(in_srgb,var(--green)_16%,transparent)]"
              aria-hidden="true"
            />
            <span className="font-mono text-[11px] tracking-[1.2px] text-green">
              COMMITTEE IN SESSION
            </span>
          </span>
        </Reveal>

        <Reveal delay={80}>
          <h1 className="max-w-[15ch] text-[clamp(42px,6.4vw,80px)] font-extrabold leading-[1.03] tracking-[-2px]">
            The committee trades your <span className="text-accent">theses.</span>
          </h1>
        </Reveal>

        <Reveal delay={180}>
          <p className="my-[24px] mb-8 max-w-[54ch] text-[17px] leading-[1.6] text-muted">
            Tag the agent on X with a Base-token thesis. Five agents grade the author, the token and
            the argument — A to F — and pay you{" "}
            <b className="font-semibold text-text">25% of every winning trade.</b> Live, on-chain, on
            the record.
          </p>
        </Reveal>

        <Reveal delay={260}>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/pitch"
              className="inline-flex items-center gap-[9px] rounded-md border border-transparent bg-[linear-gradient(160deg,#f0b455,#e09a2e)] px-[22px] py-[13px] text-[14.5px] font-semibold text-[#1a1305] shadow-primary transition-transform hover:-translate-y-px"
            >
              Submit a thesis
            </Link>
            <Link
              href="/#pipeline"
              className="inline-flex items-center gap-[9px] rounded-md border border-border-2 bg-panel-2 px-[22px] py-[13px] text-[14.5px] font-semibold text-text transition-colors hover:border-border-hi"
            >
              See the pipeline →
            </Link>
          </div>
        </Reveal>

        <Reveal delay={340}>
          <div className="mt-[34px] flex flex-wrap items-stretch gap-[22px]">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[18px] font-semibold leading-none tabular-nums text-text">
                <CountUp value={31} />
              </span>
              <span className="font-mono text-[9.5px] uppercase tracking-[1.3px] text-dim">
                Theses funded
              </span>
            </div>
            <span className="w-px bg-border" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[18px] font-semibold leading-none tabular-nums text-green">
                <CountUp value={1.91} decimals={2} /> Ξ
              </span>
              <span className="font-mono text-[9.5px] uppercase tracking-[1.3px] text-dim">
                Paid to authors
              </span>
            </div>
            <span className="w-px bg-border" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[18px] font-semibold leading-none tabular-nums text-text">
                <CountUp value={73} suffix="%" />
              </span>
              <span className="font-mono text-[9.5px] uppercase tracking-[1.3px] text-dim">
                Win rate
              </span>
            </div>
            <span className="w-px bg-border" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[18px] font-semibold leading-none text-accent">
                Open
              </span>
              <span className="font-mono text-[9.5px] uppercase tracking-[1.3px] text-dim">
                Source · on Base
              </span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
