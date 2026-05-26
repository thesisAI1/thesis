/**
 * Central configuration. Reads from process.env.
 *
 * In development, run with `--env-file=.env` to load a .env file, or rely on
 * the defaults below — which keep the system in free, mock mode.
 */

export type RunMode = "mock" | "live";

function str(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

function num(key: string, fallback: number): number {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : Number(v);
}

const port = num("PORT", 4319);

export const config = {
  /** "mock" = no external calls, $0. "live" = real APIs. */
  mode: str("THESIS_MODE", "mock") as RunMode,

  frontrun: {
    apiKey: str("FRONTRUN_API_KEY"),
    apiBase: str("FRONTRUN_API_BASE", "https://api.frontrun.pro"),
  },

  x: {
    bearerToken: str("X_BEARER_TOKEN"),
    /** The agent's own X numeric id — the account whose mentions we poll. */
    agentUserId: str("X_AGENT_USER_ID"),
    /** OAuth 1.0a credentials — required for the agent to post replies. */
    apiKey: str("X_API_KEY"),
    apiSecret: str("X_API_SECRET"),
    accessToken: str("X_ACCESS_TOKEN"),
    accessSecret: str("X_ACCESS_SECRET"),
  },

  baseData: {
    provider: str("BASEDATA_PROVIDER", "dexscreener"),
    birdeyeKey: str("BIRDEYE_API_KEY"),
  },

  chain: {
    rpcUrl: str("BASE_RPC_URL", "https://sepolia.base.org"),
    chainId: num("BASE_CHAIN_ID", 84532),
    tradingWalletKey: str("TRADING_WALLET_PRIVATE_KEY"),
    /** Safety gate: real on-chain buys/sells only fire when this is "true". */
    liveTradingArmed: str("LIVE_TRADING_ARMED") === "true",
    /** Base WETH (mainnet). */
    weth: str("BASE_WETH", "0x4200000000000000000000000000000000000006"),
    /** Uniswap v3 SwapRouter02 on Base (mainnet). */
    swapRouter: str("BASE_SWAP_ROUTER", "0x2626664c2603336E57B271c5C0b26F421741e481"),
    /** Pool fee tier in hundredths of a bip (10000 = 1%). */
    feeTier: num("BASE_SWAP_FEE_TIER", 10000),
    /** Slippage tolerance for swaps, in percent. */
    slippagePct: num("SWAP_SLIPPAGE_PCT", 8),
    /** The launched $THESIS token contract (for buyback & burn). */
    thesisToken: str("THESIS_TOKEN_ADDRESS"),
    /** Team / maintenance wallet — receives 25% of each winning trade. */
    teamWallet: str("TEAM_WALLET"),
    /** Where bought-back $THESIS is sent to be burned. */
    burnAddress: str("BURN_ADDRESS", "0x000000000000000000000000000000000000dEaD"),
    /** 0x Swap API key. With this, swaps route through 0x's aggregator
     *  (Uniswap v2/v3/v4, Aerodrome, 150+ DEXes) instead of direct Uniswap v3.
     *  Get a free key at https://dashboard.0x.org/. */
    zeroExApiKey: str("ZEROEX_API_KEY"),
  },

  llm: {
    anthropicKey: str("ANTHROPIC_API_KEY"),
    model: str("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001"),
  },

  server: {
    port,
    /** Public base URL the dashboard is served from. */
    publicBaseUrl: str("PUBLIC_BASE_URL", `http://localhost:${port}`),
    /** Shared secret for the /admin/test-swap endpoint. If blank, the endpoint
     *  is disabled — set this to a random long string to enable it. */
    adminSecret: str("ADMIN_SECRET"),
  },

  service: {
    /** How often to poll X for new mentions (seconds). */
    pollIntervalSec: num("POLL_INTERVAL_SEC", 300),
    /** How often the review loop pulls the next submission from the queue. */
    reviewIntervalSec: num("REVIEW_INTERVAL_SEC", 20),
    /** How often to check open positions for TP / SL. */
    monitorIntervalSec: num("MONITOR_INTERVAL_SEC", 15),
    /** Where the file-backed store keeps its JSON data. */
    dataDir: str("DATA_DIR", "./data"),
  },

  auditor: {
    /** A token must be at least this old to be eligible (avoids fast dumps). */
    minTokenAgeHours: num("MIN_TOKEN_AGE_HOURS", 1),
    /** The top 10 holders may control at most this share of supply (percent). */
    maxTop10Pct: num("MAX_TOP10_PCT", 30),
    /** Market cap floor (USD). Anything below is too micro-cap / rug-prone. */
    minMarketCapUsd: num("MIN_MARKET_CAP_USD", 40_000),
    /** Market cap ceiling (USD). Anything above is already "discovered" — limited upside. */
    maxMarketCapUsd: num("MAX_MARKET_CAP_USD", 3_000_000),
    /** BaseScan / Etherscan API key — looks up a token's deployer for the
     *  Clanker launchpad check. The free tier is enough. */
    basescanApiKey: str("BASESCAN_API_KEY"),
  },

  triage: {
    /** Minimum X follower count for an author to be considered. */
    minAuthorFollowers: num("MIN_AUTHOR_FOLLOWERS", 50),
    /** Minimum words of actual thesis text (after stripping tag + contract). */
    minThesisWords: num("MIN_THESIS_WORDS", 6),
    /** One author can have at most one submission reviewed per this window. */
    authorCooldownHours: num("AUTHOR_COOLDOWN_HOURS", 3),
    /** The same contract is not re-reviewed within this window. */
    contractDedupHours: num("CONTRACT_DEDUP_HOURS", 6),
    /** Maximum full reviews per rolling hour (cost ceiling). */
    reviewBudgetPerHour: num("REVIEW_BUDGET_PER_HOUR", 30),
    /** A queued submission older than this is dropped as stale (minutes). */
    queueTtlMin: num("QUEUE_TTL_MIN", 40),
  },

  trading: {
    positionSizeMinPct: num("POSITION_SIZE_MIN_PCT", 5),
    positionSizeMaxPct: num("POSITION_SIZE_MAX_PCT", 10),
    /** Lowest grade that triggers a BUY. Default "B" — only A and B fund.
     *  Set lower (e.g. "D") during launch/testing to exercise more swaps. */
    minBuyGrade: str("MIN_BUY_GRADE", "B"),
    /** Laddered take-profit — sell `sellPct`% of the position at +`gainPct`%. */
    takeProfitTiers: [
      { gainPct: 100, sellPct: 50 },
      { gainPct: 200, sellPct: 25 },
      { gainPct: 300, sellPct: 15 },
      { gainPct: 1000, sellPct: 10 },
    ],
    /** Stop-loss — sells the whole remainder; trails `stopLossPct`% below the
     *  highest milestone reached (entry, then each take-profit tier level). */
    stopLossPct: num("STOP_LOSS_PCT", 30),
    maxBuysPerDay: num("MAX_BUYS_PER_DAY", 15),
    buyCooldownMinutes: num("BUY_COOLDOWN_MINUTES", 30),
  },
} as const;

/** True when adapters should use their mock implementation (no cost, no keys). */
export function useMock(): boolean {
  return config.mode !== "live";
}
