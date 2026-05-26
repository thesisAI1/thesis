/**
 * THESIS — shared domain model.
 *
 * These types are the contract between every agent in the pipeline.
 * A submission flows: X post -> Submission -> AuthorReport + TokenReport
 * -> Verdict -> TradeOrder -> Position -> Distribution.
 */

/** Chains we recognise. The project trades on Base; others are detected and skipped. */
export type Chain =
  | "base"
  | "base-sepolia"
  | "ethereum"
  | "bsc"
  | "solana"
  | "unknown";

/** A parsed submission: an X post that tagged the agent with a thesis + contract. */
export interface Submission {
  /** X post (tweet) id. */
  postId: string;
  /** Stable numeric X user id of the author. NEVER key on @handle — handles change. */
  authorXId: string;
  /** @handle at time of submission (display only). */
  authorHandle: string;
  /** The free-text thesis the author wrote. */
  thesisText: string;
  /** Token contract address found in the post. */
  contractAddress: string;
  /** Chain the contract is on, once resolved. */
  chain: Chain;
  /** Permalink to the post. */
  postUrl: string;
  /** ISO timestamp of the post. */
  postedAt: string;
}

/** A contract this author posted in the past, with optional performance. */
export interface PastContract {
  address: string;
  chain: Chain;
  postedAt: string;
  /** Price multiple since the author posted it, if known. 2.5 = +150%. */
  performanceX?: number;
}

/** Output of The Registrar — author / X-account credibility. */
export interface AuthorReport {
  authorXId: string;
  /** 0-100. Higher = more credible author. */
  score: number;
  isLikelyBot: boolean;
  accountAgeDays: number;
  smartFollowerCount: number;
  pastContracts: PastContract[];
  /** Share of past calls that did well (>= 2x), 0-1. */
  pastHitRate: number;
  /** Human-readable flags, e.g. "posts only own deployments". */
  flags: string[];
  /** Step-by-step reasoning, for the live agent stream. */
  reasoning: string[];
}

/** A holder of the analysed token. */
export interface Holder {
  address: string;
  /** Share of total supply, 0-1. */
  share: number;
  label?: string;
}

/** Output of The Auditor — on-chain token forensics. */
export interface TokenReport {
  contractAddress: string;
  chain: Chain;
  /** 0-100. Higher = healthier token. */
  score: number;
  launchpad: string | null;
  liquidityUsd: number;
  /** Token market capitalisation in USD. */
  marketCapUsd: number;
  /** ISO timestamp the token launched (its trading pair was created). */
  launchedAt: string;
  /** Combined share held by the top 10 holders, 0-1. */
  top10Concentration: number;
  topHolders: Holder[];
  isHoneypot: boolean;
  /** Human-readable flags, e.g. "deployer holds 18%". */
  flags: string[];
  /** Step-by-step reasoning, for the live agent stream. */
  reasoning: string[];
}

export type Grade = "A" | "B" | "C" | "D" | "F";
export type Decision = "BUY" | "SKIP";

/** Output of The Dean — the final verdict. */
export interface Verdict {
  submission: Submission;
  authorReport: AuthorReport;
  tokenReport: TokenReport;
  grade: Grade;
  decision: Decision;
  /** 0-1. */
  confidence: number;
  /** Position size as a share of portfolio. 0.07 = 7%. */
  positionSizePct: number;
  rationale: string;
  /** Step-by-step reasoning, for the live agent stream. */
  reasoning: string[];
}

/** One rung of the laddered take-profit. */
export interface TakeProfitTier {
  /** Price multiple that triggers this rung. 2 = +100%. */
  priceX: number;
  /** Fraction of the ORIGINAL position to sell here. 0.5 = 50%. */
  sellFraction: number;
}

/** A buy order The Bursar will execute. */
export interface TradeOrder {
  contractAddress: string;
  chain: Chain;
  /** Amount of the quote asset (ETH on Base) to spend. */
  amountInEth: number;
  /** Laddered take-profit rungs, in ascending price order. */
  takeProfits: TakeProfitTier[];
  /** Price multiple at which to stop out the whole remainder. 0.70 = -30%. */
  stopLossX: number;
}

/**
 * A trading position.
 *  - "open"   — actively monitored; take-profit tiers and the stop-loss live.
 *  - "closed" — fully exited (every tier cleared, or stopped out).
 */
export interface Position {
  id: string;
  /** The X post that triggered this trade — used to reply on it. */
  postId: string;
  /** Numeric X id of the author whose submission triggered this trade. */
  authorXId: string;
  /** Author @handle at submission time (display only). */
  authorHandle: string;
  order: TradeOrder;
  status: "open" | "closed";
  entryPriceEth: number;
  /** Tx hash of the entry buy. */
  entryTxHash: string;
  /** Fraction of the original position still held (1 -> ... -> moonbag -> 0). */
  remainingFraction: number;
  /** How many take-profit tiers have fired. */
  tiersHit: number;
  /** Total realised profit in ETH across every partial exit (negative = loss). */
  realisedPnlEth: number;
  /** Price / tx of the most recent partial exit. */
  lastExitPriceEth?: number;
  lastExitTxHash?: string;
  openedAt: string;
  closedAt?: string;
}

/** The 25/25/25/25 split The Endowment performs on a profitable exit. */
export interface Distribution {
  positionId: string;
  totalProfitEth: number;
  /** 25% — paid to the submitter. */
  toAuthorEth: number;
  /** 25% — compounded into the trading wallet. */
  toPortfolioEth: number;
  /** 25% — team / maintenance wallet. */
  toTeamEth: number;
  /** 25% — buys $THESIS on the open market and burns it. */
  toBuybackEth: number;
  /** Resolved payout wallet of the author, or null if not registered. */
  authorWallet: string | null;
}

/**
 * A link between an X account and a payout wallet. Recorded the first time an
 * author answers a payout request on X with a wallet address, so any future
 * win pays them directly. Keyed on the numeric X user id — handles change,
 * ids do not.
 */
export interface RegistryEntry {
  xUserId: string;
  /** @handle at the time of linking (display only). */
  handle: string;
  /** The payout wallet address. */
  wallet: string;
  /** ISO timestamp the link was created. */
  linkedAt: string;
}

/**
 * A persisted summary of one Faculty review — the feed behind the public
 * transparency dashboard. One record per submission the agents reviewed.
 */
export interface ReviewRecord {
  reviewedAt: string;
  postId: string;
  postUrl: string;
  authorXId: string;
  authorHandle: string;
  contractAddress: string;
  chain: Chain;
  /** The Registrar's author score, 0-100. */
  authorScore: number;
  /** The Auditor's token score, 0-100. */
  tokenScore: number;
  grade: Grade;
  decision: Decision;
  confidence: number;
  rationale: string;
  /** Set if the Bursar opened a position. */
  positionId?: string;
  /** Set if the Dean approved but the Bursar declined (rate limit, etc.). */
  skippedReason?: string;
}
