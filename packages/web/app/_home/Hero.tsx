/**
 * Hero (design `.hero`): the eyebrow, the headline, the lede, the two CTAs, the
 * proof-stat row, and the glowing wireframe theta with five orbiting faculty
 * dots. Reveal + count-up + line-draw are handled by the client children;
 * everything else is static server markup.
 */
import Link from "next/link";
import { Reveal } from "./Reveal";
import { CountUp } from "./CountUp";
import { DrawSvg } from "./DrawSvg";
import styles from "./home.module.css";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <DrawSvg className={styles.theta} ariaHidden>
        <svg viewBox="0 0 400 400" fill="none">
          <ellipse cx="200" cy="200" rx="118" ry="160" stroke="var(--border)" strokeWidth="1.5" />
          <ellipse
            cx="200"
            cy="200"
            rx="92"
            ry="128"
            stroke="var(--accent)"
            strokeWidth="2.5"
            data-draw
          />
          <rect
            x="118"
            y="188"
            width="164"
            height="22"
            rx="11"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.5"
          />
          <line x1="200" y1="40" x2="200" y2="360" stroke="var(--border)" strokeWidth="1" />
          <line x1="40" y1="200" x2="360" y2="200" stroke="var(--border)" strokeWidth="1" />
          <circle cx="200" cy="200" r="178" stroke="var(--border)" strokeWidth="1" />
          <circle cx="111" cy="46" r="5" fill="var(--blue)" />
          <circle cx="289" cy="46" r="5" fill="var(--accent)" />
          <circle cx="378" cy="200" r="5" fill="var(--purple)" />
          <circle cx="289" cy="354" r="5" fill="var(--green)" />
          <circle cx="111" cy="354" r="5" fill="var(--red)" />
        </svg>
      </DrawSvg>

      <div className="relative z-[2] mx-auto max-w-shell px-7 pb-[72px] pt-[88px]">
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
              href="/#submit"
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
