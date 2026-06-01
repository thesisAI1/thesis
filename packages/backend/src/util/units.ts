/**
 * Token amount → base-unit conversion, overflow-safe.
 *
 * A naive `BigInt(Math.round(amount * 10 ** decimals))` does the multiply in
 * float, which silently loses integer precision once the product exceeds
 * Number.MAX_SAFE_INTEGER (2^53 ≈ 9.007e15) — e.g. 50M tokens × 1e9 (9 decimals)
 * = 5e16. That rounds to the nearest representable double BEFORE BigInt, so the
 * wrong amount gets sent to the aggregator. This builds the integer from a
 * fixed-decimal STRING instead, so it never multiplies large magnitudes.
 *
 * Mirrors how the Base adapter avoids the same trap via `parseEther(x.toFixed(18))`.
 */
export function toBaseUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  // Render with a few extra digits, then TRUNCATE (floor) to `decimals` — never
  // round UP past the holding, which on a sell would request more than we own
  // and revert. All as strings, so no large float multiply (the 2^53 overflow).
  const s = amount.toFixed(Math.min(20, decimals + 4));
  const [whole, frac = ""] = s.split(".");
  const fracTrunc = frac.slice(0, decimals).padEnd(decimals, "0");
  const digits = (whole + fracTrunc).replace(/^0+(?=\d)/, "");
  return BigInt(digits === "" ? "0" : digits);
}
