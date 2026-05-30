"use client";

/**
 * One agent in the live Faculty Room (design `.agent`). Dims when idle, lights
 * to its colour when active (glow + pulsing status dot), settles to a tinted
 * border when done. The body streams the agent's reasoning lines; the marked
 * verdict line renders bold with a ■ marker.
 */
import type { CSSProperties } from "react";
import { Sigil, AGENT_COLOR, AGENT_META, type AgentName } from "@/components/shell/Sigil";
import type { AgentState } from "./roomState";
import { idleLine } from "./roomState";
import styles from "./home.module.css";

export interface AgentCardProps {
  agent: AgentName;
  state: AgentState;
}

export function AgentCard({ agent, state }: AgentCardProps) {
  const meta = AGENT_META[agent];
  const phaseClass =
    state.phase === "active" ? styles.active : state.phase === "done" ? styles.done : "";
  const style = { "--c": AGENT_COLOR[agent] } as CSSProperties;

  return (
    <article
      className={`relative overflow-hidden rounded-lg border border-border bg-[linear-gradient(180deg,#131825_0%,#0e1219_100%)] p-4 before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent)] before:content-[''] ${styles.agent} ${phaseClass}`}
      style={style}
    >
      <div className="flex items-center gap-3">
        <Sigil agent={agent} size={40} />
        <div className="flex-1">
          <div className="text-[15px] font-extrabold">{meta.name}</div>
          <div className="font-mono text-[10.5px] tracking-[0.4px] text-dim">{meta.role}</div>
        </div>
        <span className={styles.agentStatus} aria-hidden="true" />
      </div>

      <div className={styles.agentBody}>
        {state.lines.length === 0 ? (
          <div className="text-dim">{idleLine(agent)}</div>
        ) : (
          state.lines.map((line, i) => (
            <div
              key={`${line}-${i}`}
              className={`${styles.aLine}${state.verdictLineIndex === i ? ` ${styles.verdict}` : ""}`}
            >
              {line}
            </div>
          ))
        )}
      </div>
    </article>
  );
}
