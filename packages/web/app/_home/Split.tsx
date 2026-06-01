/**
 * The 25% split — a slim four-segment bar (author · portfolio · maintenance ·
 * buyback & burn), each in its agent-adjacent colour. Lives in the $THESIS
 * section; the emotional "you get paid" copy now lives in the Manifesto, so this
 * is just the at-a-glance breakdown of where a winning trade goes.
 */
import { Reveal } from "./Reveal";

const QUARTERS: Array<{ label: string; color: string }> = [
  { label: "To the author", color: "var(--blue)" },
  { label: "To the portfolio", color: "var(--green)" },
  { label: "To maintenance", color: "var(--purple)" },
  { label: "Buyback & burn", color: "var(--red)" },
];

export function Split() {
  return (
    <div className="mb-[18px]">
      <Reveal className="mb-3.5">
        <h3 className="text-[clamp(19px,2.3vw,25px)] font-extrabold leading-[1.12] tracking-[-0.6px]">
          Win, and a <span className="text-accent">quarter</span> comes back to the author.
        </h3>
      </Reveal>

      <Reveal>
        <div className="flex overflow-hidden rounded-[10px] border border-border">
          {QUARTERS.map((q, i) => (
            <div
              key={q.label}
              className={`flex flex-1 items-center gap-2.5 px-3 py-[13px] ${i > 0 ? "border-l border-border" : ""}`}
            >
              <span className="h-8 w-[3px] shrink-0 rounded-full" style={{ background: q.color }} aria-hidden="true" />
              <div className="min-w-0">
                <div
                  className="text-[19px] font-extrabold leading-none tracking-[-0.5px] tabular-nums"
                  style={{ color: q.color }}
                >
                  25%
                </div>
                <div className="mt-1 font-mono text-[10px] uppercase leading-tight tracking-[0.4px] text-muted">
                  {q.label}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  );
}
