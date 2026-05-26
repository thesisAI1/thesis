/**
 * The live event bus.
 *
 * The pipeline and monitor publish events here as agents work; the SSE
 * endpoint (/api/stream) forwards them to every connected dashboard, so the
 * website can watch the committee deliberate in real time.
 */

import { EventEmitter } from "node:events";

export interface StreamEvent {
  type:
    | "review:start"
    | "agent:active"
    | "agent:step"
    | "agent:done"
    | "review:verdict"
    | "review:end"
    | "endowment";
  [key: string]: unknown;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

/** Publish an event to every connected dashboard. */
export function publish(event: StreamEvent): void {
  emitter.emit("event", event);
}

/** Subscribe to the live stream. Returns an unsubscribe function. */
export function subscribe(listener: (event: StreamEvent) => void): () => void {
  emitter.on("event", listener);
  return () => emitter.off("event", listener);
}
