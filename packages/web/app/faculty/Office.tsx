"use client";

/**
 * The Faculty Office — generated pixel-art office set as a backdrop, with a live
 * overlay split into two layers by purpose:
 *   · ON the art (hugging walls/corners, floor left clear for future characters):
 *     the active office glows in its colour, a room nameplate, a corner pip, the
 *     Dean's grade stamp, and ticket / coin props that travel between rooms.
 *   · OFF the art, in a side "Committee transcript": every agent's streamed
 *     reasoning, so text never covers the office floor (or the characters later).
 * The bottom-right Archive is a clickable hotspot into the live record.
 *
 * Reuses the homepage engine wholesale (useEventStream + reduceRoom + the
 * scripted demos); state drives the spatial overlay + the transcript.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import type { Grade } from "@/lib/api";
import { useEventStream, type StreamEvent } from "@/lib/useEventStream";
import { AGENT_COLOR, AGENT_META, Sigil, type AgentName } from "@/components/shell/Sigil";
import {
  ROOM_ORDER,
  emptyRoom,
  reduceRoom,
  reduceRoomFrom,
  type RoomState,
} from "@/app/_home/roomState";
import { DEMO_REVIEWS, demoEvents } from "@/app/_home/demoReview";
import styles from "./office.module.css";

/* Room rectangles + desk points as % of the square stage, snapped to the walls
   of the generated office art (public/faculty/office.png). */
interface Rect {
  left: number;
  top: number;
  w: number;
  h: number;
}
interface Spot {
  x: number;
  y: number;
}

// Room boxes detected from the office art's walls (a pixel scan of office.png).
const ROOMS: Record<AgentName, Rect> = {
  registrar: { left: 3.3, top: 5, w: 35.2, h: 27.4 }, // top-left office
  auditor: { left: 3.1, top: 34.3, w: 36.3, h: 27.9 }, // mid-left office
  bursar: { left: 3.1, top: 62.4, w: 35.5, h: 28.2 }, // bottom-left office
  dean: { left: 39.4, top: 34.3, w: 21.8, h: 27.9 }, // central manager's office
  endowment: { left: 61.2, top: 34.3, w: 34.7, h: 27.9 }, // mid-right office
};
/** The beep-orb sits at each office's floor centre (lower-middle of the room). */
function orbSpot(r: Rect): Spot {
  return { x: r.left + r.w / 2, y: r.top + r.h * 0.66 };
}
const DESK: Record<AgentName, Spot> = {
  registrar: orbSpot(ROOMS.registrar),
  auditor: orbSpot(ROOMS.auditor),
  bursar: orbSpot(ROOMS.bursar),
  dean: orbSpot(ROOMS.dean),
  endowment: orbSpot(ROOMS.endowment),
};
/** Each office's glowing monitor screen (centroids detected from the art) — the
 *  trade ticket lands here so the BUY shows ON the Bursar's computer. */
const MONITOR: Record<AgentName, Spot> = {
  registrar: { x: 13.9, y: 11.7 },
  auditor: { x: 13.9, y: 41.1 },
  bursar: { x: 13.8, y: 70.9 },
  dean: { x: 49.6, y: 37.4 },
  endowment: { x: 75.7, y: 41.2 },
};
/** The Records Archive (bottom-right room) — the clickable hotspot. */
const ARCHIVE: Rect = { left: 62, top: 62.4, w: 33.8, h: 28.2 };

const GRADE_COLOR: Record<Grade, string> = {
  A: "var(--green)",
  B: "var(--blue)",
  C: "var(--accent)",
  D: "var(--red)",
  F: "var(--red)",
};

const GAP_AFTER_REVIEW_MS = 2400;
const LIVE_HOLD_MS = 6500;

export function Office() {
  const { events, lastEvent, connected } = useEventStream();
  const liveRoom = useMemo(() => reduceRoomFrom(events), [events]);

  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [demoRoom, setDemoRoom] = useState<RoomState>(emptyRoom);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const idxRef = useRef(0);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => {
    if (!lastEvent) return;
    setMode("live");
    const t = setTimeout(() => setMode("demo"), LIVE_HOLD_MS);
    return () => clearTimeout(t);
  }, [lastEvent]);

  useEffect(() => {
    if (mode !== "demo") {
      clearTimers();
      return;
    }
    let cancelled = false;
    const play = () => {
      if (cancelled) return;
      clearTimers();
      const review = DEMO_REVIEWS[idxRef.current % DEMO_REVIEWS.length];
      idxRef.current += 1;
      setDemoRoom(emptyRoom());
      const schedule = demoEvents(review, { settle: true });
      for (const { at, event } of schedule) {
        timers.current.push(
          setTimeout(() => setDemoRoom((prev) => reduceRoom(prev, event as StreamEvent)), at),
        );
      }
      const end = schedule.length ? schedule[schedule.length - 1].at : 0;
      timers.current.push(
        setTimeout(() => {
          if (!cancelled) play();
        }, end + GAP_AFTER_REVIEW_MS),
      );
    };
    timers.current.push(setTimeout(play, 600));
    return () => {
      cancelled = true;
      clearTimers();
    };
  }, [mode, clearTimers]);

  const room = mode === "live" ? liveRoom : demoRoom;
  const submission = room.submission;
  const verdict = room.verdict;
  const buy = verdict?.decision === "BUY";

  const statusText =
    mode === "live"
      ? connected
        ? "Watching X for new submissions…"
        : "Reconnecting to the committee feed…"
      : "The committee is between reviews…";

  const showIntake = !!submission && room.agents.dean.phase === "idle" && !verdict;
  const ticketSpot = room.agents.bursar.phase !== "idle" ? MONITOR.bursar : MONITOR.dean;
  const settled = room.agents.endowment.lines.length > 0;

  // Agents that have something to show in the transcript (working or done).
  const feedAgents = ROOM_ORDER.filter(
    (a) => room.agents[a].lines.length > 0 || room.agents[a].phase === "active",
  );

  return (
    <div className="mt-[26px]">
      {/* Session header */}
      <div className={styles.header}>
        <span className={styles.status}>
          <span className={styles.pulse} aria-hidden="true" />
          {submission || mode === "live" ? "COMMITTEE IN SESSION" : "THE FACULTY OFFICE"}
        </span>
        <span className={styles.nowText}>
          {submission ? (
            <>
              <b>{submission.authorHandle}</b> — “{truncate(submission.thesisText, 86)}”
            </>
          ) : (
            statusText
          )}
        </span>
        {submission ? <span className={styles.ca}>{submission.contractAddress}</span> : null}
      </div>

      <div className={styles.layout}>
        {/* The office art + spatial overlay (floor kept clear) */}
        <div className={styles.stageWrap}>
          <div
            className={styles.stage}
            role="img"
            aria-label="A top-down office: five agents review a thesis across their rooms."
          >
            <div className={styles.overlay}>
              {ROOM_ORDER.map((agent) => {
                const a = room.agents[agent];
                const r = ROOMS[agent];
                const lit = a.phase !== "idle";
                const color = AGENT_COLOR[agent];
                // Every agent beeps on their monitor screen; only the Dean
                // (central office, no desk screen) beeps at the floor centre.
                const orb = agent === "dean" ? DESK[agent] : MONITOR[agent];
                // the Endowment's left wall is a doorway, so nudge its tag right
                const nameDx = agent === "endowment" ? 5 : 1.5;
                // the Endowment settles straight to "done", so also beep it while
                // it's paying out in-session (it never passes through "active").
                const beeping =
                  a.phase === "active" ||
                  (agent === "endowment" && room.inSession && a.lines.length > 0);
                return (
                  <div key={agent}>
                    <div
                      className={styles.nameTag}
                      data-on={lit ? "true" : undefined}
                      data-anchor={agent === "dean" ? undefined : "tl"}
                      style={
                        agent === "dean"
                          ? // Dean: centred near the bottom of the office (kept as-is).
                            ({
                              left: `${r.left + r.w / 2}%`,
                              top: `${r.top + r.h - 3}%`,
                              ["--c" as string]: color,
                            } as CSSProperties)
                          : // Everyone else: tucked high into the office's top-left corner.
                            ({
                              left: `${r.left + nameDx}%`,
                              top: `${r.top + 0.5}%`,
                              ["--c" as string]: color,
                            } as CSSProperties)
                      }
                    >
                      <Sigil agent={agent} size={15} />
                      {AGENT_META[agent].name.replace(/^The\s+/, "")}
                    </div>
                    {beeping ? (
                      <span
                        className={styles.beep}
                        aria-hidden="true"
                        style={
                          { left: `${orb.x}%`, top: `${orb.y}%`, ["--c" as string]: color } as CSSProperties
                        }
                      />
                    ) : null}
                  </div>
                );
              })}

              {showIntake ? (
                <span className={styles.intake}>📄&nbsp;NEW&nbsp;THESIS · {submission?.authorHandle}</span>
              ) : null}

              {buy ? (
                <span className={styles.ticket} style={{ left: `${ticketSpot.x}%`, top: `${ticketSpot.y}%` }}>
                  BUY
                </span>
              ) : null}

              {settled ? (
                <span
                  key="coin"
                  className={styles.coin}
                  style={{ left: `${DESK.endowment.x}%`, top: `${DESK.endowment.y}%` }}
                >
                  Ξ
                </span>
              ) : null}

              {verdict ? (
                <span
                  className={styles.stamp}
                  style={{ left: "58%", top: "40%", ["--g" as string]: GRADE_COLOR[verdict.grade] } as CSSProperties}
                >
                  <span className={styles.stampGrade}>{verdict.grade}</span>
                  <span className={styles.stampDecision}>{buy ? "FUND IT" : "SKIP"}</span>
                </span>
              ) : null}

              <Link
                href="/dashboard"
                className={styles.archive}
                style={{
                  left: `${ARCHIVE.left}%`,
                  top: `${ARCHIVE.top}%`,
                  width: `${ARCHIVE.w}%`,
                  height: `${ARCHIVE.h}%`,
                }}
                aria-label="Open the Archive — the live trading record"
              >
                <span className={styles.archiveLabel}>The Archive · open the record →</span>
              </Link>
            </div>
          </div>
        </div>

        {/* The committee transcript — reasoning off the floor */}
        <aside className={styles.aside}>
          <div className={styles.asideHead}>
            <span className={styles.pulse} aria-hidden="true" />
            Committee transcript
          </div>
          {feedAgents.length === 0 ? (
            <p className={styles.feedWait}>
              {submission
                ? "Convening the committee…"
                : "Waiting for the next submission. The committee reviews each thesis in public — its reasoning streams here."}
            </p>
          ) : (
            <div className={styles.feed}>
              {feedAgents.map((agent) => {
                const a = room.agents[agent];
                const color = AGENT_COLOR[agent];
                return (
                  <div
                    key={agent}
                    className={styles.feedBlock}
                    data-on={a.phase === "active" ? "true" : undefined}
                    style={{ ["--c" as string]: color } as CSSProperties}
                  >
                    <div className={styles.feedAgent}>
                      <span className={styles.feedDot} aria-hidden="true" />
                      {AGENT_META[agent].name}
                    </div>
                    {a.lines.length === 0 ? (
                      <div className={styles.feedIdle}>working…</div>
                    ) : (
                      a.lines.map((line, i) => (
                        <div
                          key={`${line}-${i}`}
                          className={`${styles.feedLine}${a.verdictLineIndex === i ? ` ${styles.v}` : ""}`}
                        >
                          {line}
                        </div>
                      ))
                    )}
                  </div>
                );
              })}
              {verdict ? (
                <span
                  className={styles.vChip}
                  style={{ ["--g" as string]: GRADE_COLOR[verdict.grade] } as CSSProperties}
                >
                  VERDICT · {verdict.grade} · {buy ? "FUND IT" : "SKIP"}
                </span>
              ) : null}
            </div>
          )}
        </aside>
      </div>

      {/* Legend + hint */}
      <div className={styles.legend}>
        {ROOM_ORDER.map((agent) => (
          <span
            key={agent}
            className={styles.legendItem}
            style={{ ["--c" as string]: AGENT_COLOR[agent] } as CSSProperties}
          >
            <span className={styles.legendSwatch} aria-hidden="true" />
            {AGENT_META[agent].name}
          </span>
        ))}
        <span className={styles.hint}>Click the Archive ↘ for the live record</span>
      </div>
    </div>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
