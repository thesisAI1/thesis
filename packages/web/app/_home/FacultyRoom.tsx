"use client";

/**
 * The live Faculty Room (design `#pipeline` / `.agents`) — the pipeline in
 * session. Consumes the SSE stream via useEventStream and folds it into room
 * state (which agent is active, their streamed reasoning, the verdict banner).
 *
 * When the live stream is idle, a "Run a review" control replays a scripted
 * demo through the SAME reducer, so the room is never dead in mock mode. The
 * moment real events arrive, the live stream takes over as the source of truth.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Grade } from "@/lib/api";
import { useEventStream, type StreamEvent } from "@/lib/useEventStream";
import { AgentCard } from "./AgentCard";
import { SectionHead } from "./SectionHead";
import {
  emptyRoom,
  reduceRoom,
  reduceRoomFrom,
  type RoomState,
} from "./roomState";
import { DEMO_REVIEWS, demoEvents } from "./demoReview";
import styles from "./home.module.css";

const GRADE_BG: Record<Grade, string> = {
  A: "rgba(63,185,132,.16)",
  B: "rgba(79,157,222,.16)",
  C: "rgba(230,163,62,.16)",
  D: "rgba(224,101,62,.18)",
  F: "rgba(224,101,62,.18)",
};
const GRADE_FG: Record<Grade, string> = {
  A: "var(--green)",
  B: "var(--blue)",
  C: "var(--accent)",
  D: "var(--red)",
  F: "var(--red)",
};

function FlowConnector() {
  return <div className={styles.flow} aria-hidden="true" />;
}

export function FacultyRoom() {
  const { events, connected } = useEventStream();

  // Live room state, folded from the SSE buffer.
  const liveRoom = useMemo(() => reduceRoomFrom(events), [events]);
  const liveActive = events.length > 0;

  // Demo room state, driven locally when the live stream is idle.
  const [demoRoom, setDemoRoom] = useState<RoomState>(emptyRoom);
  const [demoRunning, setDemoRunning] = useState(false);
  const demoIndexRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // If the live stream ever produces events, abandon any demo in flight.
  useEffect(() => {
    if (liveActive) {
      clearTimers();
      setDemoRunning(false);
    }
  }, [liveActive, clearTimers]);

  const runDemo = useCallback(() => {
    if (demoRunning || liveActive) return;
    clearTimers();
    const review = DEMO_REVIEWS[demoIndexRef.current % DEMO_REVIEWS.length];
    demoIndexRef.current += 1;
    setDemoRunning(true);
    setDemoRoom(emptyRoom());

    const schedule = demoEvents(review);
    for (const { at, event } of schedule) {
      timersRef.current.push(
        setTimeout(() => {
          setDemoRoom((prev) => reduceRoom(prev, event as StreamEvent));
        }, at),
      );
    }
    const end = schedule[schedule.length - 1]?.at ?? 0;
    timersRef.current.push(setTimeout(() => setDemoRunning(false), end + 100));
  }, [demoRunning, liveActive, clearTimers]);

  const room = liveActive ? liveRoom : demoRoom;
  const busy = liveActive ? liveRoom.inSession : demoRunning;

  const activity = liveActive
    ? room.inSession && room.submission
      ? `Reviewing a thesis from ${room.submission.authorHandle}…`
      : connected
        ? "Watching X for new submissions…"
        : "Reconnecting to the committee feed…"
    : demoRunning && room.submission
      ? `Reviewing a thesis from ${room.submission.authorHandle}…`
      : "Watching X for new submissions…";

  return (
    <section id="pipeline" className="py-[30px]">
      <div className="mx-auto max-w-shell px-7">
        <SectionHead index="01" title="The Faculty Room" meta="THE PIPELINE · LIVE" />

        <div className="mb-[14px] flex flex-wrap items-center gap-[14px] rounded-md border border-border bg-panel px-4 py-3">
          <span className="inline-flex items-center gap-2 font-mono text-[11.5px] tracking-[0.8px] text-green">
            <span className={styles.roomPulse} aria-hidden="true" />
            COMMITTEE IN SESSION
          </span>
          <span className="font-mono text-[12.5px] text-muted">{activity}</span>
          <span className="ml-auto">
            <button
              type="button"
              onClick={runDemo}
              disabled={busy}
              className="cursor-pointer rounded-[9px] border-none bg-[linear-gradient(160deg,#f0b455,#e09a2e)] px-[18px] py-[9px] text-[13px] font-semibold text-[#1a1305] shadow-primary transition-transform enabled:hover:-translate-y-px disabled:cursor-default disabled:opacity-55 disabled:shadow-none"
            >
              {busy ? "Reviewing…" : "Run a review →"}
            </button>
          </span>
        </div>

        {room.submission ? (
          <div className="mb-[14px] rounded-[13px] border border-border-2 bg-[linear-gradient(160deg,#141a26,#10141d)] px-5 py-[18px]">
            <div className="font-mono text-[10px] uppercase tracking-[2px] text-dim">
              NOW REVIEWING
            </div>
            <div className="mt-1 text-[18px] font-extrabold">{room.submission.authorHandle}</div>
            <div className="mt-[6px] text-[14.5px] italic leading-[1.5] text-muted">
              “{room.submission.thesisText}”
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-[7px] border border-border bg-void px-[10px] py-[5px] font-mono text-[12px] text-blue">
                {room.submission.contractAddress}
              </span>
            </div>
          </div>
        ) : null}

        <div className="grid gap-[14px]">
          <div className="grid grid-cols-1 gap-[14px] md:grid-cols-2">
            <AgentCard agent="registrar" state={room.agents.registrar} />
            <AgentCard agent="auditor" state={room.agents.auditor} />
          </div>
          <FlowConnector />
          <AgentCard agent="dean" state={room.agents.dean} />
          <FlowConnector />
          <AgentCard agent="bursar" state={room.agents.bursar} />
          <FlowConnector />
          <AgentCard agent="endowment" state={room.agents.endowment} />
        </div>

        {room.verdict ? <VerdictBanner verdict={room.verdict} /> : null}

        <p className="mt-[18px] max-w-[92ch] text-[13.5px] leading-[1.65] text-muted">
          A mention clears the <b className="font-semibold text-text">free triage filters</b>, then
          the <b className="font-semibold text-text">Registrar</b> and{" "}
          <b className="font-semibold text-text">Auditor</b> run in parallel. The{" "}
          <b className="font-semibold text-text">Dean</b> reads both plus the argument and grades
          A–F. An A or B and the <b className="font-semibold text-text">Bursar</b> opens a position;
          on a winning close the <b className="font-semibold text-text">Endowment</b> splits the
          profit four ways and pays the author on X.
        </p>
      </div>
    </section>
  );
}

function VerdictBanner({ verdict }: { verdict: RoomState["verdict"] }) {
  if (!verdict) return null;
  const buy = verdict.decision === "BUY";
  return (
    <div
      className={`mt-4 flex items-center gap-[18px] rounded-lg border border-border-2 bg-[linear-gradient(160deg,#161d2b,#10141d)] px-[22px] py-[18px] ${styles.verdictBanner}`}
    >
      <div
        className="grid h-[62px] w-[62px] place-items-center rounded-lg text-[34px] font-extrabold"
        style={{ background: GRADE_BG[verdict.grade], color: GRADE_FG[verdict.grade] }}
      >
        {verdict.grade}
      </div>
      <div className="text-[16px] font-semibold">
        {buy ? (
          <>
            <strong>Grade {verdict.grade} — FUND IT</strong>
            <span className="mt-[2px] block text-[13px] font-normal text-muted">
              The Bursar opens a {(verdict.positionSizePct * 100).toFixed(1)}% position
            </span>
          </>
        ) : (
          <>
            <strong>Grade {verdict.grade} — SKIP</strong>
            <span className="mt-[2px] block text-[13px] font-normal text-muted">
              Only A and B grades are funded
            </span>
          </>
        )}
      </div>
    </div>
  );
}
