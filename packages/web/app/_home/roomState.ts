/**
 * Faculty-Room reduction — turns the raw SSE stream into the room's view state.
 *
 * The backend publishes a flat event stream (review:start → agent:active /
 * agent:step / agent:done per agent → review:verdict → review:end, plus
 * endowment on a profitable close). This module folds those into:
 *   - which agent is active / done, and each agent's streamed reasoning lines
 *   - the "now reviewing" submission header
 *   - the Dean's verdict banner
 *
 * Payload keys mirror the publish() call sites in
 * packages/backend/src/pipeline/index.ts and monitor/index.ts.
 */
import type { AgentName } from "@/components/shell/Sigil";
import type { Decision, Grade } from "@/lib/api";
import type { StreamEvent } from "@/lib/useEventStream";

/** Agents in committee order — the order the room renders and runs them. */
export const ROOM_ORDER: AgentName[] = ["registrar", "auditor", "dean", "bursar", "endowment"];

export type AgentPhase = "idle" | "active" | "done";

/** A single agent's live state inside the room. */
export interface AgentState {
  phase: AgentPhase;
  lines: string[];
  /** Marks the final, bold "verdict" line (Bursar's fill / settlement line). */
  verdictLineIndex: number | null;
}

/** The submission currently under review. */
export interface NowReviewing {
  authorHandle: string;
  thesisText: string;
  contractAddress: string;
  postUrl: string | null;
}

/** The Dean's grade + decision, surfaced as the verdict banner. */
export interface RoomVerdict {
  grade: Grade;
  decision: Decision;
  positionSizePct: number;
}

export interface RoomState {
  submission: NowReviewing | null;
  agents: Record<AgentName, AgentState>;
  verdict: RoomVerdict | null;
  /** True between review:start and review:end. */
  inSession: boolean;
}

const IDLE_LINES: Record<AgentName, string> = {
  registrar: "idle — awaiting a submission",
  auditor: "idle — awaiting a submission",
  dean: "idle — awaiting the reports",
  bursar: "idle — awaiting a verdict",
  endowment: "idle — settles trades when they close",
};

export function idleAgent(): AgentState {
  return { phase: "idle", lines: [], verdictLineIndex: null };
}

export function idleLine(agent: AgentName): string {
  return IDLE_LINES[agent];
}

export function emptyRoom(): RoomState {
  return {
    submission: null,
    verdict: null,
    inSession: false,
    agents: {
      registrar: idleAgent(),
      auditor: idleAgent(),
      dean: idleAgent(),
      bursar: idleAgent(),
      endowment: idleAgent(),
    },
  };
}

function isAgentName(value: unknown): value is AgentName {
  return typeof value === "string" && (ROOM_ORDER as string[]).includes(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Apply one event to the room state, returning the next state. Pure — safe to
 *  fold over the bounded event buffer on each render. */
export function reduceRoom(state: RoomState, event: StreamEvent): RoomState {
  switch (event.type) {
    case "review:start": {
      const submission = event.submission as Record<string, unknown> | undefined;
      const fresh = emptyRoom();
      return {
        ...fresh,
        inSession: true,
        submission: submission
          ? {
              authorHandle: asString(submission.authorHandle),
              thesisText: asString(submission.thesisText),
              contractAddress: asString(submission.contractAddress),
              postUrl: typeof submission.postUrl === "string" ? submission.postUrl : null,
            }
          : null,
      };
    }

    case "agent:active": {
      if (!isAgentName(event.agent)) return state;
      const agent = event.agent;
      return {
        ...state,
        inSession: true,
        agents: { ...state.agents, [agent]: { ...state.agents[agent], phase: "active" } },
      };
    }

    case "agent:step": {
      if (!isAgentName(event.agent)) return state;
      const agent = event.agent;
      const text = asString(event.text);
      if (!text) return state;
      const prev = state.agents[agent];
      return {
        ...state,
        agents: {
          ...state.agents,
          [agent]: { ...prev, phase: "active", lines: [...prev.lines, text] },
        },
      };
    }

    case "agent:done": {
      if (!isAgentName(event.agent)) return state;
      const agent = event.agent;
      const prev = state.agents[agent];
      // The Bursar's last line is the actionable fill/skip — render it bold.
      const verdictLineIndex =
        agent === "bursar" && prev.lines.length > 0 ? prev.lines.length - 1 : prev.verdictLineIndex;
      return {
        ...state,
        agents: { ...state.agents, [agent]: { ...prev, phase: "done", verdictLineIndex } },
      };
    }

    case "review:verdict": {
      const grade = event.grade;
      const decision = event.decision;
      if (grade !== "A" && grade !== "B" && grade !== "C" && grade !== "D" && grade !== "F") {
        return state;
      }
      if (decision !== "BUY" && decision !== "SKIP") return state;
      return {
        ...state,
        verdict: { grade, decision, positionSizePct: asNumber(event.positionSizePct) },
      };
    }

    case "review:end":
      return { ...state, inSession: false };

    case "endowment": {
      const prev = state.agents.endowment;
      const author = asString(event.authorHandle);
      const eth = asNumber(event.toAuthorEth);
      const lines = [
        "A position closed in profit — splitting 25/25/25/25",
        `Paid ${eth.toFixed(4)} ETH to ${author || "the author"} on X`,
        "Buyback share burns $THESIS on the open market",
      ];
      return {
        ...state,
        agents: {
          ...state.agents,
          endowment: { phase: "done", lines, verdictLineIndex: lines.length - 1 },
        },
      };
    }

    default:
      return state;
  }
}

/** Fold a whole event buffer into room state from empty. */
export function reduceRoomFrom(events: StreamEvent[]): RoomState {
  return events.reduce(reduceRoom, emptyRoom());
}
