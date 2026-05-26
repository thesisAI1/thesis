/**
 * Deterministic pseudo-randomness — so mock data is varied but stable.
 * The same input always yields the same value, which keeps a given mock
 * author or token consistent across calls.
 */

/** A deterministic value in [0, 1) derived from a string (FNV-1a hash). */
export function seed(input: string, salt = ""): number {
  let h = 2166136261;
  const s = `${input}|${salt}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}
