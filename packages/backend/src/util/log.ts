/** Minimal timestamped logger. */

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export const log = {
  info: (msg: string): void => console.log(`[${ts()}] ${msg}`),
  warn: (msg: string): void => console.warn(`[${ts()}] WARN  ${msg}`),
  error: (msg: string): void => console.error(`[${ts()}] ERROR ${msg}`),
};
