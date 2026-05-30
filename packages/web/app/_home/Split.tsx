/**
 * The 25% split (design `.split-lead` + `.split`) — the headline promise and
 * the four quarter tiles (author · portfolio · maintenance · buyback & burn),
 * each topped with its agent-adjacent colour.
 */
import type { CSSProperties } from "react";
import { Reveal } from "./Reveal";
import styles from "./home.module.css";

const QUARTERS: Array<{ label: string; color: string }> = [
  { label: "To the author", color: "var(--blue)" },
  { label: "To the portfolio", color: "var(--green)" },
  { label: "To maintenance", color: "var(--purple)" },
  { label: "Buyback & burn", color: "var(--red)" },
];

export function Split() {
  return (
    <div className="mb-[14px]">
      <Reveal className="mb-4">
        <h3 className="max-w-[24ch] text-[clamp(26px,3.6vw,42px)] font-extrabold leading-[1.08] tracking-[-1px]">
          Win, and a <span className="text-accent">quarter</span> comes back to the mind that called
          it.
        </h3>
      </Reveal>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {QUARTERS.map((q, i) => {
          const style = { "--c": q.color } as CSSProperties;
          return (
            <Reveal key={q.label} delay={i * 80}>
              <div
                className={`rounded-[12px] border border-border bg-panel px-[22px] py-6 ${styles.qtr}`}
                style={style}
              >
                <div
                  className={`text-[46px] font-extrabold leading-none tracking-[-2px] tabular-nums ${styles.qtrPct}`}
                >
                  25%
                </div>
                <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.5px] text-muted">
                  {q.label}
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </div>
  );
}
