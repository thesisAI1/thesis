/**
 * The Pipeline — alternating cards that unfurl out of the docking orbs.
 *
 * A highlighted entry (your thesis, no orb) leads into four agent cards laid
 * out left/right of a central spine. The five faculty orbs from the hero scroll
 * down and dock at each card's node(s); as an orb lands, OrbField flips the
 * card's `data-active`, and the card clip-unfurls FROM the node (its
 * transform-origin) with the agent-colour glow igniting. The Registrar &
 * Auditor card takes two orbs (blue + amber) — the parallel pair converging.
 *
 * Cards are visible by default (SSR / no-JS); OrbField adds `data-orbs-live`
 * to arm the unfurl. Triage was dropped so the five orbs map 1:1 to the faculty.
 */
import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";
import styles from "./pipeline.module.css";

interface DockOrb {
  dock: string;
  color: string;
}
interface Agent {
  index: string;
  name: string;
  who: string;
  desc: string;
  color: string;
  orbs: DockOrb[];
}

const AGENTS: Agent[] = [
  {
    index: "02",
    name: "The Registrar & Auditor",
    who: "Author × Token · in parallel",
    desc: "The two strands are read at once — the Registrar scores the author, the Auditor runs on-chain forensics on the token.",
    color: "var(--blue)",
    orbs: [
      { dock: "reg", color: "var(--blue)" },
      { dock: "aud", color: "var(--accent)" },
    ],
  },
  {
    index: "03",
    name: "The Dean",
    who: "The verdict",
    desc: "The Dean weighs both reports and your argument, then issues a grade A–F with a decision to fund or skip.",
    color: "var(--purple)",
    orbs: [{ dock: "dean", color: "var(--purple)" }],
  },
  {
    index: "04",
    name: "The Bursar",
    who: "The trade",
    desc: "An A or B is funded — a 5–10% position on Base with a take-profit ladder and a trailing stop attached at entry.",
    color: "var(--green)",
    orbs: [{ dock: "bursar", color: "var(--green)" }],
  },
  {
    index: "05",
    name: "The Endowment",
    who: "The split · your 25%",
    desc: "On a winning close the profit divides 25/25/25/25 — and your quarter is paid on X, under your own post.",
    color: "var(--red)",
    orbs: [{ dock: "endow", color: "var(--red)" }],
  },
];

export function Pipeline() {
  return (
    <section id="process" className="py-[30px]">
      <div className="mx-auto max-w-shell px-7">
        <SectionHead index="00" title="The Pipeline" meta="FIVE STAGES · TYPED HANDOFFS" />

        <div className={styles.wrap}>
          <div className={styles.spine} aria-hidden="true" />

          {/* 01 — the thesis (highlighted entry, no orb) */}
          <Reveal>
            <div className={styles.entry}>
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[11px] text-accent">01</span>
                <span className="text-[17px] font-extrabold tracking-[-0.3px]">
                  A thesis is filed
                </span>
              </div>
              <div className={`${styles.entryTag} mt-[6px]`}>You · on X · the trigger</div>
              <p className="mt-2 max-w-[62ch] text-[13.5px] leading-[1.6] text-muted">
                You post a thesis, tag the committee and paste a Base contract address. Two strands
                begin — the author, and the token — and the five faculty convene.
              </p>
            </div>
          </Reveal>

          <ol>
            {AGENTS.map((stage, i) => {
              const side = i % 2 === 0 ? styles.left : styles.right;
              return (
                <li key={stage.index} className={`${styles.row} ${side}`}>
                  <span className={styles.connector} aria-hidden="true" />
                  <div
                    className={styles.card}
                    data-stage
                    style={{ ["--c" as string]: stage.color } as React.CSSProperties}
                  >
                    <div className={styles.nodes}>
                      {stage.orbs.map((orb) => (
                        <span
                          key={orb.dock}
                          data-orb-dock={orb.dock}
                          className={styles.node}
                          style={{ ["--c" as string]: orb.color } as React.CSSProperties}
                          aria-hidden="true"
                        />
                      ))}
                    </div>

                    <div className="flex items-baseline gap-3">
                      <span className="font-mono text-[11px] text-dim">{stage.index}</span>
                      <span className="text-[15px] font-extrabold tracking-[-0.2px]">
                        {stage.name}
                      </span>
                    </div>
                    <div
                      className="mt-[5px] font-mono text-[10px] uppercase tracking-[1.4px]"
                      style={{ color: stage.color }}
                    >
                      {stage.who}
                    </div>
                    <p className="mt-2 text-[13px] leading-[1.6] text-muted">{stage.desc}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
