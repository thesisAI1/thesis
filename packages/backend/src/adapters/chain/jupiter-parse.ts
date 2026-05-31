/**
 * Pure JSON-parse helpers for Jupiter v6 Aggregator API responses.
 *
 * Extracted (like kyber-parse.ts) so they can be fixture-tested without
 * constructing RealSolanaChain (which needs a base58 keypair + live RPC).
 * Jupiter is the Solana analogue of KyberSwap: a /quote call returns the best
 * route + amounts, and a /swap call returns a base64 versioned transaction we
 * sign locally and submit. Behaviour mirrors the inline checks in solana.real.ts.
 */

/** One leg of a Jupiter route plan (shape is loose — we only need presence). */
export interface JupiterRoutePlanStep {
  swapInfo?: Record<string, unknown>;
  percent?: number;
}

/** A Jupiter /quote response (success) or `{ error }` (no route). */
export interface JupiterQuote {
  inputMint?: string;
  inAmount?: string;
  outputMint?: string;
  /** Output amount in the output mint's base units (lamports for WSOL). */
  outAmount?: string;
  otherAmountThreshold?: string;
  priceImpactPct?: string;
  routePlan?: JupiterRoutePlanStep[];
  /** Present only on failure. */
  error?: string;
}

/** A Jupiter /swap response. */
export interface JupiterSwap {
  /** base64-encoded signed-able VersionedTransaction. */
  swapTransaction?: string;
  lastValidBlockHeight?: number;
  error?: string;
}

/**
 * Validate a Jupiter /quote response.
 * Throws with a descriptive message when Jupiter returned an error or omitted
 * the output amount (no route / no liquidity).
 */
export function parseJupiterQuote(json: JupiterQuote): Required<Pick<JupiterQuote, "outAmount">> & JupiterQuote {
  if (json.error || !json.outAmount) {
    throw new Error(`Jupiter: no route (${json.error ?? "missing outAmount"}).`);
  }
  return json as Required<Pick<JupiterQuote, "outAmount">> & JupiterQuote;
}

/**
 * Validate a Jupiter /swap response.
 * Throws when the base64 swapTransaction is missing.
 */
export function parseJupiterSwap(json: JupiterSwap): Required<Pick<JupiterSwap, "swapTransaction">> & JupiterSwap {
  if (json.error || !json.swapTransaction) {
    throw new Error(`Jupiter: swap build failed (${json.error ?? "missing swapTransaction"}).`);
  }
  return json as Required<Pick<JupiterSwap, "swapTransaction">> & JupiterSwap;
}
