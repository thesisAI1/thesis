/**
 * Typed server-side fetchers for the THESIS backend.
 *
 * These mirror the EXACT response shapes assembled in
 * packages/backend/src/server/index.ts (apiStatus / buildDashboardPayload /
 * apiLeaderboard). Domain primitives are imported from @thesis/shared so the
 * contract never drifts; only the handler-computed view shapes (enriched open
 * positions, slimmed closed positions, the leaderboard row) are declared here.
 *
 * IMPORTANT: invoked by Server Components at REQUEST time, never at module top
 * level. Server-side fetch must hit the absolute backend origin — Next's
 * /api/* rewrites only apply to browser requests.
 */
import type { Chain, Decision, Grade, ReviewRecord } from "@thesis/shared";

/** Absolute backend origin. Mirrors next.config.ts; the rewrite that proxies
 *  /api/* is browser-only, so Server Components must call the origin directly. */
const API_ORIGIN = process.env.THESIS_API_ORIGIN ?? "http://localhost:4319";

/** Match the backend's 15s dashboard cache so we don't refetch more often than
 *  the upstream rebuilds. */
const REVALIDATE_SECONDS = 15;

// --- /api/status -----------------------------------------------------------

/** GET /api/status — apiStatus(). */
export interface StatusData {
  mode: string;
  openPositions: number;
  totalPositions: number;
}

// --- /api/dashboard --------------------------------------------------------

/** An open position, enriched by buildDashboardPayload() with live price, the
 *  token symbol, the grade, market caps and unrealised PnL (OpenPositionView). */
export interface OpenPositionView {
  id: string;
  contractAddress: string;
  /** Chain the position trades on — decides the native-unit symbol (ETH Base / SOL Solana).
   *  The `*Eth` value fields are native units scoped to this chain. */
  chain: Chain;
  /** Token ticker — empty when DexScreener doesn't know it yet. */
  tokenSymbol: string;
  /** Token logo (DexScreener), or null when none is on file. */
  tokenLogoUrl: string | null;
  authorHandle: string;
  authorAvatarUrl: string | null;
  grade: string | null;
  postUrl: string | null;
  status: string;
  tiersHit: number;
  tierCount: number;
  /** Take-profit ladder, each {gainPct, sellPct}, in order. */
  tierTargets: Array<{ gainPct: number; sellPct: number }>;
  remainingPct: number;
  amountInEth: number;
  entryPriceEth: number;
  currentPriceEth: number;
  marketCapAtEntryUsd: number | null;
  marketCapNowUsd: number | null;
  realisedPnlEth: number;
  unrealizedPnlEth: number;
  unrealizedPct: number;
  openedAt: string;
  entryTxHash: string;
}

/** A closed position, slimmed by buildDashboardPayload() for the record table. */
export interface ClosedPositionView {
  id: string;
  contractAddress: string;
  /** Chain the trade settled on — decides the native-unit symbol (ETH Base / SOL Solana). */
  chain: Chain;
  tokenSymbol: string;
  /** Token logo (DexScreener), or null when none is on file. */
  tokenLogoUrl: string | null;
  authorHandle: string;
  postUrl: string | null;
  amountInEth: number;
  entryPriceEth: number;
  exitPriceEth: number;
  /** Market cap (USD) at entry / exit. Exit MC is derived from entry MC × the
   *  price ratio (constant supply). Null for positions opened before entry MC
   *  was persisted — render a dash. These drive the table's Entry/Exit columns. */
  entryMarketCapUsd: number | null;
  exitMarketCapUsd: number | null;
  realisedPnlEth: number;
  realisedPct: number;
  tiersHit: number;
  openedAt: string;
  closedAt: string;
  entryTxHash: string;
  exitTxHash: string;
}

/** The portfolio block — wallet + open-positions value, USD references, PnL. */
export interface PortfolioSummary {
  walletAddress: string;
  balanceEth: number;
  openPositionsValueEth: number;
  totalPortfolioValueEth: number;
  /** ETH/USD spot (5-min cached). 0 until the first fetch returns. */
  ethUsdPrice: number;
  walletBalanceUsd: number;
  openPositionsValueUsd: number;
  totalPortfolioValueUsd: number;
  realizedPnlEth: number;
  openCount: number;
  closedCount: number;
  winCount: number;
  /** 0-1. */
  winRate: number;
}

/** Review tallies. */
export interface ReviewsSummary {
  total: number;
  buys: number;
  skips: number;
}

/** Distribution totals across every payout. The four `to*` sums feed the
 *  "total paid to authors" / buyback / team / portfolio KPIs. */
export interface DistributionsSummary {
  count: number;
  /** Sum of toAuthorEth — the "total paid to authors" figure. */
  toAuthors: number;
  toPortfolio: number;
  toTeam: number;
  toBuyback: number;
}

/** Submission funnel counters. */
export interface FunnelSummary {
  seen: number;
  passed: number;
  reviewed: number;
  queued: number;
}

/** One ticker-tape event — mirrors ActivityItem in
 *  packages/backend/src/activity.ts. An in-memory ring (last 50, newest first);
 *  the marquee renders the pre-formatted `summary`. */
export interface ActivityItem {
  /** ISO timestamp. */
  at: string;
  kind: "buy" | "tp" | "sl" | "manual" | "aging" | "lottery" | "burn" | "skip";
  /** Pre-formatted human-readable line, e.g. "@author hit TP1 (+100%)". */
  summary: string;
  authorHandle?: string;
  tokenSymbol?: string;
  positionId?: string;
  amountEth?: number;
}

/** Cumulative running totals + a rolling 7-day win rate — the counters block.
 *  Each `*TotalEth` is "ever distributed to this leg since launch". */
export interface CountersSummary {
  authorsTotalEth: number;
  lotteryTotalEth: number;
  buybackTotalEth: number;
  portfolioTotalEth: number;
  /** 0-1, rolling 7-day. */
  winRate7d: number;
  winRate7dCount: number;
}

/** Last-24h win highlight strip. */
export interface RecentWinsSummary {
  count24h: number;
  profitEth24h: number;
  closedCount24h: number;
}

/** Per-author wins/total/winRate, keyed by LOWERCASED handle, so a position or
 *  trade row can show inline author stats without an extra lookup. */
export interface AuthorStat {
  wins: number;
  total: number;
  /** 0-1. */
  winRate: number;
}
export type AuthorStatsMap = Record<string, AuthorStat>;

/** GET /api/dashboard — buildDashboardPayload(). */
export interface DashboardData {
  mode: string;
  portfolio: PortfolioSummary;
  reviews: ReviewsSummary;
  distributions: DistributionsSummary;
  funnel: FunnelSummary;
  openPositions: OpenPositionView[];
  closedPositions: ClosedPositionView[];
  recentReviews: ReviewRecord[];
  /** Cumulative running totals + rolling 7-day win rate. */
  counters: CountersSummary;
  /** Last-24h win highlight. */
  recentWins: RecentWinsSummary;
  /** Per-author stats, keyed by lowercased handle. */
  authorStats: AuthorStatsMap;
  /** Last 50 ticker events (newest first). */
  recentActivity: ActivityItem[];
}

// --- /api/leaderboard ------------------------------------------------------

/** One author row — apiLeaderboard() LeaderboardEntry. */
export interface LeaderboardEntry {
  rank: number;
  xUserId: string;
  authorHandle: string;
  authorAvatarUrl: string | null;
  submitted: number;
  funded: number;
  closed: number;
  wins: number;
  /** 0-1. */
  winRate: number;
  totalEarnedEth: number;
  bestTradePct: number;
}

/** GET /api/leaderboard — apiLeaderboard(). */
export interface LeaderboardData {
  mode: string;
  totalAuthors: number;
  leaderboard: LeaderboardEntry[];
}

// --- fetchers --------------------------------------------------------------

/** Thrown when a backend endpoint is unreachable or returns a non-2xx status.
 *  Pages catch this to render the empty/error state. */
export class ThesisApiError extends Error {
  constructor(
    readonly endpoint: string,
    readonly status: number | null,
    cause?: unknown,
  ) {
    super(`THESIS API ${endpoint} failed${status !== null ? ` (${status})` : ""}`);
    this.name = "ThesisApiError";
    if (cause !== undefined) this.cause = cause;
  }
}

/** GET an /api/* endpoint from the absolute backend origin, revalidated to
 *  match the upstream cache. Throws ThesisApiError on transport or HTTP error. */
async function getJson<T>(endpoint: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}${endpoint}`, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
  } catch (cause) {
    throw new ThesisApiError(endpoint, null, cause);
  }
  if (!res.ok) throw new ThesisApiError(endpoint, res.status);
  // Parse inside the boundary: a 200 with a malformed/empty body throws here,
  // and must surface as a ThesisApiError so pages degrade to their empty state
  // rather than crashing on an uncaught SyntaxError.
  try {
    return (await res.json()) as T;
  } catch (cause) {
    throw new ThesisApiError(endpoint, res.status, cause);
  }
}

/** GET /api/status. */
export function getStatus(): Promise<StatusData> {
  return getJson<StatusData>("/api/status");
}

/** GET /api/dashboard — the full transparency payload. */
export function getDashboard(): Promise<DashboardData> {
  return getJson<DashboardData>("/api/dashboard");
}

/** GET /api/leaderboard — author ranking by realised author share. */
export function getLeaderboard(): Promise<LeaderboardData> {
  return getJson<LeaderboardData>("/api/leaderboard");
}

/** Verdict/grade re-exports so consumers can pin tape/badge values to the
 *  shared union without a second import. */
export type { Decision, Grade };
