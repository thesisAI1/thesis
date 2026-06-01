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
 * Reuses the homepage engine wholesale (useEventStream + reduceRoomFrom); state
 * drives the spatial overlay + the transcript. When no review is streaming the
 * office simply rests — the committee sits idle at their desks. There is no
 * scripted stand-in: every word on screen is a real review or nothing at all.
 */
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import type { Grade } from "@/lib/api";
import { useEventStream } from "@/lib/useEventStream";
import { AGENT_COLOR, AGENT_META, Sigil, type AgentName } from "@/components/shell/Sigil";
import { ROOM_ORDER, emptyRoom, reduceRoomFrom } from "@/app/_home/roomState";
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

/* The cast (public/faculty/cast/*.png). Each agent stands at their desk, feet on
   the floor just below the monitor; the Author waits in the central lobby. STAND
   is the feet point (sprites are bottom-centre anchored). CHAR_ASPECT is each
   idle sprite's measured w/h, so the container box never reflows on idle↔type. */
const STAND: Record<AgentName, Spot> = {
  registrar: { x: 13.9, y: 26 },
  auditor: { x: 13.9, y: 55 },
  bursar: { x: 13.8, y: 84 },
  dean: { x: 50.1, y: 48.3 },
  endowment: { x: 75.7, y: 55 },
};
const AUTHOR_SPOT: Spot = { x: 50, y: 86.3 };
const CHAR_ASPECT: Record<AgentName, number> = {
  registrar: 0.389,
  auditor: 0.397,
  dean: 0.517,
  bursar: 0.4,
  endowment: 0.343,
};
const AUTHOR_ASPECT = 0.43;
const CHAR_H = 15; // standing sprite height as % of the square stage

/* When a computer-using office goes active the agent sits down at the terminal —
   a seated sprite turned to face LEFT toward the screen (the monitor sits left of
   the stool in every room), planted on the stool below the desk. SIT is the seat
   point; sprites are bottom-centre anchored. The Dean has no terminal — he only
   stamps — so he keeps his standing pose and is absent here. */
type Typist = Exclude<AgentName, "dean">;
const SIT: Record<Typist, Spot> = {
  registrar: { x: 18.1, y: 25.2 },
  auditor: { x: 17.4, y: 55.2 },
  bursar: { x: 17.2, y: 84.9 },
  endowment: { x: 79.7, y: 55.5 },
};
// Each seated sprite now includes its own stool (the office art's stools were
// removed), so it's one rigid unit anchored by the stool's base on the floor.
const WORK_ASPECT: Record<Typist, number> = {
  registrar: 0.549,
  auditor: 0.53,
  bursar: 0.525,
  endowment: 0.537,
};
const WORK_H = 16; // seated sprite (incl. stool) height as % of the square stage

const GRADE_COLOR: Record<Grade, string> = {
  A: "var(--green)",
  B: "var(--blue)",
  C: "var(--accent)",
  D: "var(--red)",
  F: "var(--red)",
};

// Grace after a review ends (or settles) before the office rests — long enough
// for the verdict / payout to land before the room goes quiet.
const LIVE_HOLD_MS = 6500;
// Safety window for mid-review events: an LLM gap between agents can leave the
// stream silent for several seconds, so we hold "live" much longer between
// steps. Only a genuinely stalled/dead stream waits this out before resting —
// it never flickers to idle in the middle of an active review.
const STALE_STREAM_MS = 30000;

export function Office() {
  const { events, lastEvent, connected } = useEventStream();
  const liveRoom = useMemo(() => reduceRoomFrom(events), [events]);
  // A stable empty room is the resting state — agents idle at their desks.
  const idleRoom = useMemo(() => emptyRoom(), []);

  // "idle" — nothing streaming: the committee sits at their desks.
  // "live" — a real review is streaming in from the SSE pipeline.
  // No demo/scripted mode exists: when nothing is live, the office rests.
  const [mode, setMode] = useState<"idle" | "live">("idle");

  // A streamed event flips the room live; silence then settles it back to idle.
  // Each new event re-arms the timer, so the office stays live for the whole
  // review. Terminal events (review:end / endowment) use the short grace so the
  // verdict or payout lingers, then rests; mid-review events use the long safety
  // window so an LLM gap between agents never flickers the room back to idle.
  useEffect(() => {
    if (!lastEvent) return;
    setMode("live");
    const terminal = lastEvent.type === "review:end" || lastEvent.type === "endowment";
    const hold = terminal ? LIVE_HOLD_MS : STALE_STREAM_MS;
    const t = setTimeout(() => setMode("idle"), hold);
    return () => clearTimeout(t);
  }, [lastEvent]);

  const room = mode === "live" ? liveRoom : idleRoom;
  const submission = room.submission;
  const verdict = room.verdict;
  const buy = verdict?.decision === "BUY";

  // With no submission on screen we're resting — but the bot is still watching
  // X, so the status says so honestly rather than implying a review is underway.
  const statusText = connected
    ? "Watching X for new submissions…"
    : "Reconnecting to the committee feed…";

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
                // the Endowment's left wall is a doorway, so nudge its tag right
                const nameDx = agent === "endowment" ? 5 : 1.5;
                // the agent is "at work" (sits down + glows) while active; the
                // Endowment settles straight to "done", so also count it while
                // it's paying out in-session (it never passes through "active").
                const beeping =
                  a.phase === "active" ||
                  (agent === "endowment" && room.inSession && a.lines.length > 0);
                const stand = STAND[agent];
                const isDean = agent === "dean";
                return (
                  <div key={agent}>
                    {/* Standing pose, facing you. For the four typists this is the
                        idle layer (fades out when they sit to work). The Dean
                        never sits — he keeps this pose and just glows + stamps. */}
                    <span
                      className={styles.char}
                      data-show={isDean || !beeping ? "true" : undefined}
                      data-on={isDean && beeping ? "true" : undefined}
                      aria-hidden="true"
                      style={
                        {
                          left: `${stand.x}%`,
                          top: `${stand.y}%`,
                          height: `${CHAR_H}%`,
                          width: `${CHAR_H * CHAR_ASPECT[agent]}%`,
                          backgroundImage: `url(/faculty/cast/${agent}-idle.png)`,
                          ["--c" as string]: color,
                        } as CSSProperties
                      }
                    />
                    {/* Active: seated at the terminal, facing left toward the
                        screen, typing — bobs and glows in the agent's colour. */}
                    {!isDean ? (
                      <span
                        className={`${styles.char} ${styles.working}`}
                        data-show={beeping ? "true" : undefined}
                        aria-hidden="true"
                        style={
                          {
                            left: `${SIT[agent as Typist].x}%`,
                            top: `${SIT[agent as Typist].y}%`,
                            height: `${WORK_H}%`,
                            width: `${WORK_H * WORK_ASPECT[agent as Typist]}%`,
                            backgroundImage: `url(/faculty/cast/${agent}-work.png?v=3)`,
                            ["--c" as string]: color,
                          } as CSSProperties
                        }
                      />
                    ) : null}
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
                  </div>
                );
              })}

              {/* The author waits in the central lobby while the committee sits;
                  lights up when the Endowment pays them out. */}
              {submission ? (
                <span
                  className={`${styles.char} ${styles.author}`}
                  data-show="true"
                  data-paid={settled ? "true" : undefined}
                  aria-hidden="true"
                  style={
                    {
                      left: `${AUTHOR_SPOT.x}%`,
                      top: `${AUTHOR_SPOT.y}%`,
                      height: `${CHAR_H}%`,
                      width: `${CHAR_H * AUTHOR_ASPECT}%`,
                      backgroundImage: "url(/faculty/cast/author-idle.png)",
                      ["--c" as string]: "var(--green)",
                    } as CSSProperties
                  }
                />
              ) : null}

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
                  ETH
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
                href="/dashboard?from=archive"
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
