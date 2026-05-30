import { config } from "../config.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface EventLogEntry {
  at: string;
  level: "info" | "warn" | "error";
  area: string;
  type: string;
  msg: string;
}

export interface EventLog {
  record(entry: EventLogEntry): void;
  recent(n: number): EventLogEntry[];
}

// ── MemoryEventLog ──────────────────────────────────────────────────────────

export class MemoryEventLog implements EventLog {
  private readonly cap: number;
  private buf: EventLogEntry[] = [];

  constructor(cap?: number) {
    // Guard against cap <= 0 (e.g. OBS_RECENT_BUFFER_SIZE=0), which would make
    // slice(-0) silently discard every entry — the buffer must hold >= 1.
    this.cap = Math.max(1, cap ?? config.observability.recentBufferSize);
  }

  record(entry: EventLogEntry): void {
    this.buf.push(entry);
    if (this.buf.length > this.cap) {
      this.buf = this.buf.slice(this.buf.length - this.cap);
    }
  }

  recent(n: number): EventLogEntry[] {
    return this.buf.slice().reverse().slice(0, n);
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let instance: MemoryEventLog | undefined;

export function getEventLog(): MemoryEventLog {
  if (!instance) {
    instance = new MemoryEventLog();
  }
  return instance;
}
