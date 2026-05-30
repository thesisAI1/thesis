/**
 * Pure JSON-parse helpers for KyberSwap API responses.
 *
 * Extracted so they can be fixture-tested without constructing RealChain
 * (which requires a private key and live RPC). Behavior is identical to the
 * inline checks in real.ts — verified by reading both side-by-side.
 */

export interface KyberApiResponse<T> {
  code: number;
  message?: string;
  data?: T;
}

export interface KyberFill {
  pool?: string;
  tokenIn?: string;
  tokenOut?: string;
  swapAmount?: string;
  amountOut?: string;
  exchange?: string;
  poolType?: string;
}

export interface KyberRouteSummary {
  tokenIn: string;
  amountIn: string;
  amountInUsd?: string;
  tokenOut: string;
  amountOut: string;
  amountOutUsd?: string;
  gas?: string;
  gasPrice?: string;
  gasUsd?: string;
  route?: KyberFill[][];
}

export interface KyberRouteData {
  routeSummary: KyberRouteSummary;
  routerAddress: string;
}

export interface KyberBuildData {
  amountIn: string;
  amountInUsd?: string;
  amountOut: string;
  amountOutUsd?: string;
  gas?: string;
  gasUsd?: string;
  data: string;
  routerAddress: string;
  /** For native-ETH input swaps, the wei value to attach to the transaction. */
  transactionValue?: string;
}

/**
 * Parse a KyberSwap /routes response.
 * Throws with a descriptive message on code != 0 or missing routeSummary.
 */
export function parseKyberRoute(json: KyberApiResponse<KyberRouteData>): KyberRouteData {
  if (json.code !== 0 || !json.data?.routeSummary) {
    throw new Error(
      `KyberSwap: no liquidity (code ${json.code}: ${json.message ?? "unknown"}).`,
    );
  }
  return json.data;
}

/**
 * Parse a KyberSwap /route/build response.
 * Throws with a descriptive message on code != 0 or missing calldata.
 */
export function parseKyberBuild(json: KyberApiResponse<KyberBuildData>): KyberBuildData {
  if (json.code !== 0 || !json.data?.data) {
    throw new Error(
      `KyberSwap: build failed (code ${json.code}: ${json.message ?? "unknown"}).`,
    );
  }
  return json.data;
}
