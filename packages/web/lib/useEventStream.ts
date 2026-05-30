"use client";

/**
 * Live agent stream hook.
 *
 * Subscribes to the backend SSE endpoint and surfaces a typed, bounded buffer
 * of events plus connection state. Uses the RELATIVE "/api/stream" path so the
 * browser routes it through the Next rewrite to the backend (no CORS).
 *
 * This deliberately does NOT reduce events into Faculty-Room state — it only
 * delivers the typed stream + connection status. The homepage's Faculty Room
 * consumes `events` / `lastEvent` and does its own reduction.
 */
import { useEffect, useRef, useState } from "react";

/** The live event union — mirrors StreamEvent in packages/backend/src/events.ts.
 *  The seven `type` values are fixed; the payload is otherwise open-ended. */
export type StreamEventType =
  | "review:start"
  | "agent:active"
  | "agent:step"
  | "agent:done"
  | "review:verdict"
  | "review:end"
  | "endowment";

export interface StreamEvent {
  type: StreamEventType;
  [key: string]: unknown;
}

export interface EventStreamState {
  /** Bounded ring of the most recent events (oldest first). */
  events: StreamEvent[];
  /** The most recent event, or null before the first arrives. */
  lastEvent: StreamEvent | null;
  /** True while the EventSource is open. */
  connected: boolean;
}

/** Keep memory + render cost bounded under a long-running session. */
const MAX_EVENTS = 50;
/** Reconnect backoff, capped. */
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 15_000;

function isStreamEvent(value: unknown): value is StreamEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/** Subscribe to /api/stream. Reconnects with exponential backoff on error and
 *  closes cleanly on unmount. */
export function useEventStream(): EventStreamState {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<StreamEvent | null>(null);
  const [connected, setConnected] = useState(false);

  // Refs survive re-renders so the reconnect loop isn't torn down by state
  // updates — only by unmount.
  const sourceRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const source = new EventSource("/api/stream");
      sourceRef.current = source;

      source.onopen = () => {
        if (disposed) return;
        attemptRef.current = 0;
        setConnected(true);
      };

      source.onmessage = (e: MessageEvent<string>) => {
        if (disposed) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(e.data);
        } catch {
          return; // ignore keep-alive comments / malformed frames
        }
        if (!isStreamEvent(parsed)) return;
        const event = parsed;
        setLastEvent(event);
        setEvents((prev) => {
          const next = prev.length >= MAX_EVENTS ? prev.slice(1) : prev.slice();
          next.push(event);
          return next;
        });
      };

      source.onerror = () => {
        // EventSource auto-retries, but we control the cadence: close and
        // schedule a backed-off reconnect so a downed backend doesn't hammer.
        source.close();
        if (disposed) return;
        setConnected(false);
        const attempt = attemptRef.current++;
        const delay = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
        retryRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      sourceRef.current?.close();
      setConnected(false);
    };
  }, []);

  return { events, lastEvent, connected };
}
