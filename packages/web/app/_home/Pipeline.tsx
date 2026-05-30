/**
 * The Pipeline (design `.process` stages, distilled into a self-drawing flow).
 *
 * Six stages — file → triage → Registrar & Auditor → Dean → Bursar →
 * Endowment — laid out as a connected SVG track whose spine draws itself on
 * scroll (the [data-draw] line-draw), each node tinted with its agent colour.
 * The stage copy from the mockup's STAGES list is preserved beneath.
 */
import { Reveal } from "./Reveal";
import { DrawSvg } from "./DrawSvg";
import { SectionHead } from "./SectionHead";

interface Stage {
  index: string;
  name: string;
  who: string;
  desc: string;
  color: string;
}

const STAGES: Stage[] = [
  {
    index: "01",
    name: "A thesis is filed",
    who: "You · on X",
    desc: "You post a thesis, tag the committee and paste a Base contract address. Two strands begin — the author, and the token.",
    color: "var(--muted)",
  },
  {
    index: "02",
    name: "Triage",
    who: "Free filters",
    desc: "Free checks drop spam, low-reach authors and duplicate contracts before a single agent is spent.",
    color: "var(--muted)",
  },
  {
    index: "03",
    name: "The Registrar & Auditor",
    who: "Author × Token · in parallel",
    desc: "The two strands are read at once — the Registrar scores the author, the Auditor runs on-chain forensics on the token.",
    color: "var(--blue)",
  },
  {
    index: "04",
    name: "The Dean",
    who: "The verdict",
    desc: "The Dean weighs both reports and your argument, then issues a grade A–F with a decision to fund or skip.",
    color: "var(--purple)",
  },
  {
    index: "05",
    name: "The Bursar",
    who: "The trade",
    desc: "An A or B is funded — a 5–10% position on Base with a take-profit ladder and a trailing stop attached at entry.",
    color: "var(--green)",
  },
  {
    index: "06",
    name: "The Endowment",
    who: "The split · your 25%",
    desc: "On a winning close the profit divides 25/25/25/25 — and your quarter is paid on X, under your own post.",
    color: "var(--red)",
  },
];

/** Six evenly spaced node centres across the 1100-wide viewBox. */
const NODE_XS = STAGES.map((_, i) => 70 + i * ((1100 - 140) / (STAGES.length - 1)));

export function Pipeline() {
  return (
    <section id="process" className="py-[30px]">
      <div className="mx-auto max-w-shell px-7">
        <SectionHead index="00" title="The Pipeline" meta="SIX STAGES · TYPED HANDOFFS" />

        <Reveal>
          <div className="relative overflow-hidden rounded-lg border border-border bg-[linear-gradient(180deg,#131825_0%,#0e1219_100%)] px-[30px] pb-[26px] pt-[30px] before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent)] before:content-['']">
            <DrawSvg ariaHidden>
              <svg viewBox="0 0 1100 90" className="block h-auto w-full" fill="none">
                {/* faint full spine */}
                <line x1="70" y1="45" x2="1030" y2="45" stroke="var(--border)" strokeWidth="1" />
                {/* drawn amber spine traced on scroll */}
                <line
                  x1="70"
                  y1="45"
                  x2="1030"
                  y2="45"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeOpacity="0.55"
                  data-draw
                />
                {STAGES.map((stage, i) => (
                  <g key={stage.index}>
                    <circle
                      cx={NODE_XS[i]}
                      cy="45"
                      r="11"
                      fill="var(--panel-2)"
                      stroke={stage.color}
                      strokeWidth="2"
                    />
                    <circle cx={NODE_XS[i]} cy="45" r="3.5" fill={stage.color} />
                    <text
                      x={NODE_XS[i]}
                      y="24"
                      textAnchor="middle"
                      fontFamily="var(--mono)"
                      fontSize="11"
                      fill="var(--dim)"
                    >
                      {stage.index}
                    </text>
                  </g>
                ))}
              </svg>
            </DrawSvg>

            <div className="mt-6 grid grid-cols-2 gap-x-7 gap-y-5 md:grid-cols-3">
              {STAGES.map((stage) => (
                <div key={stage.index}>
                  <div className="text-[15px] font-extrabold tracking-[-0.2px]">{stage.name}</div>
                  <div
                    className="mt-[6px] font-mono text-[10px] uppercase tracking-[1.4px]"
                    style={{ color: stage.color }}
                  >
                    {stage.who}
                  </div>
                  <p className="mt-2 text-[13px] leading-[1.6] text-muted">{stage.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
