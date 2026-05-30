/** Minimal timestamped logger. */

import { getEventLog } from "../observability/eventLog.js";
import { publishOps, type OpsEvent } from "../observability/opsBus.js";

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export const log = {
  info: (msg: string): void => console.log(`[${ts()}] ${msg}`),
  warn: (msg: string): void => console.warn(`[${ts()}] WARN  ${msg}`),
  error: (msg: string): void => console.error(`[${ts()}] ERROR ${msg}`),
};

// ── logEvent ─────────────────────────────────────────────────────────────────

export interface LogEventInput {
  level: "info" | "warn" | "error";
  area: string;
  type: string;
  msg: string;
  ops?: OpsEvent;
}

export function logEvent(input: LogEventInput): void {
  const at = new Date().toISOString();
  const line = `[${ts()}] [${input.area}] ${input.msg}`;

  if (input.level === "error") {
    console.error(line);
  } else if (input.level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }

  getEventLog().record({ at, level: input.level, area: input.area, type: input.type, msg: input.msg });

  if (input.ops !== undefined) {
    publishOps(input.ops);
  } else if (input.level === "error") {
    publishOps({ type: "error", at, area: input.area, msg: input.msg });
  }
}
