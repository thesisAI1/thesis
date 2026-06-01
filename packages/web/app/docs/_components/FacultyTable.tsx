/**
 * The Faculty roster for the docs page (design `.card#facrows` / `.frow`). Five
 * rows — one per committee agent, in pipeline order — each pairing the agent's
 * sigil chip with its name, mono role, and a one-line description of its job.
 *
 * Names, roles and colours come from the shared Sigil module (single source of
 * truth); the longer descriptions are docs copy and live here.
 */
import type { AgentName } from "@/components/shell/Sigil";
import { AGENT_META, Sigil } from "@/components/shell/Sigil";
import { Card } from "@/components/ui/Card";

/** Pipeline order + the docs-page description for each agent. */
const FACULTY: { agent: AgentName; desc: string }[] = [
  {
    agent: "registrar",
    desc: "Account age, reach, sybil checks and the author's past calls become an Author Score.",
  },
  {
    agent: "auditor",
    desc: "Holder distribution, liquidity, launchpad origin (Clanker / Bankr / Virtuals) and honeypot checks become a Token Score.",
  },
  {
    agent: "dean",
    desc: "Weighs both reports and the argument, then issues a grade A–F with BUY or SKIP.",
  },
  {
    agent: "bursar",
    desc: "Sizes 5–10%, buys on Base, and attaches the take-profit ladder and trailing stop.",
  },
  {
    agent: "endowment",
    desc: "On a winning close, divides the profit 25/25/25/25 and pays the author on X.",
  },
];

export function FacultyTable() {
  return (
    <Card highlight className="my-[18px] px-6 py-1">
      {FACULTY.map(({ agent, desc }) => {
        const { name, role } = AGENT_META[agent];
        return (
          <div
            key={agent}
            className="flex items-start gap-[14px] border-b border-border py-[14px] last:border-b-0"
          >
            <Sigil agent={agent} size={42} className="flex-none" />
            <div>
              <div className="text-[15px] font-bold text-text">{name}</div>
              <div className="my-[2px] mb-1 font-mono text-[10px] uppercase tracking-[1px] text-dim">
                {role}
              </div>
              <div className="text-[13.5px] text-muted">{desc}</div>
            </div>
          </div>
        );
      })}
    </Card>
  );
}
