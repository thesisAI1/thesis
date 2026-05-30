/**
 * The Faculty (design `#faculty` / `.mods`) — the five committee agents as a
 * card row: sigil chip, index, name, role, and a mono key/value readout. Colours
 * + names come from the shared Sigil metadata so the page never re-declares the
 * palette; the per-agent readouts are ported from the mockup.
 */
import type { CSSProperties } from "react";
import { Sigil, AGENT_COLOR, AGENT_META, type AgentName } from "@/components/shell/Sigil";
import { SectionHead } from "./SectionHead";
import styles from "./home.module.css";

interface Readout {
  k: string;
  v: string;
}

/** Render order + each agent's mockup readout (the one-line role comes from
 *  AGENT_META, but the cards use the mockup's slightly shorter variants). */
const FACULTY: Array<{ agent: AgentName; role: string; readout: Readout[] }> = [
  {
    agent: "registrar",
    role: "Vets the author",
    readout: [
      { k: "AGE", v: "2.3y" },
      { k: "REACH", v: "38" },
      { k: "SCORE", v: "81/100" },
    ],
  },
  {
    agent: "auditor",
    role: "Audits the token",
    readout: [
      { k: "HOLDERS", v: "1,840" },
      { k: "LIQ", v: "$182K" },
      { k: "SCORE", v: "77/100" },
    ],
  },
  {
    agent: "dean",
    role: "Reads the verdict",
    readout: [
      { k: "INPUT", v: "81 · 77" },
      { k: "GRADE", v: "A" },
      { k: "CALL", v: "BUY" },
    ],
  },
  {
    agent: "bursar",
    role: "Opens the trade",
    readout: [
      { k: "SIZE", v: "8.0%" },
      { k: "TP", v: "+100/200/300" },
      { k: "SL", v: "trailing" },
    ],
  },
  {
    agent: "endowment",
    role: "Splits the profit",
    readout: [
      { k: "AUTHOR", v: "25%" },
      { k: "BURN", v: "25%" },
      { k: "PAID", v: "on X" },
    ],
  },
];

export function Faculty() {
  return (
    <section id="faculty" className="py-[30px]">
      <div className="mx-auto max-w-shell px-7">
        <SectionHead index="03" title="The Faculty" meta="FIVE AGENTS · TYPED HANDOFFS" />

        <div className="grid grid-cols-2 gap-[14px] md:grid-cols-5">
          {FACULTY.map((entry, i) => {
            const style = { "--c": AGENT_COLOR[entry.agent] } as CSSProperties;
            return (
              <div
                key={entry.agent}
                className={`relative overflow-hidden rounded-lg border border-border bg-[linear-gradient(180deg,#131825_0%,#0e1219_100%)] px-5 py-[22px] before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent)] before:content-[''] ${styles.mod}`}
                style={style}
              >
                <div className="mb-[18px] flex items-start justify-between">
                  <Sigil agent={entry.agent} size={46} />
                  <span
                    className="font-mono text-[11px]"
                    style={{ color: AGENT_COLOR[entry.agent] }}
                  >
                    0{i + 1}
                  </span>
                </div>
                <div className="mb-1 text-[18px] font-extrabold">{AGENT_META[entry.agent].name}</div>
                <div className="mb-4 font-mono text-[10px] uppercase tracking-[1.3px] text-muted">
                  {entry.role}
                </div>
                <div
                  className={`border-t border-border pt-[14px] font-mono text-[11px] leading-[1.9] text-dim ${styles.modReadout}`}
                >
                  {entry.readout.map((row) => (
                    <div key={row.k}>
                      {row.k}&nbsp;&nbsp;<span>{row.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
