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
    /** $VIRTUAL (Virtuals Protocol) on Base. A graduated Virtuals agent token's
     *  locked LP is paired against this, so a VIRTUAL-quoted DexScreener pool
     *  identifies the token as a Virtuals launch (see basedata/base-launchpad).
     *  Also the intermediate hop the price reader converts through (VIRTUAL→ETH). */
    virtualToken: str("BASE_VIRTUAL_TOKEN", "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b"),
    /** Uniswap v3 SwapRouter02 on Base (mainnet). */
    swapRouter: str("BASE_SWAP_ROUTER", "0x2626664c2603336E57B271c5C0b26F421741e481"),
    /** Pool fee tier in hundredths of a bip (10000 = 1%). */
    feeTier: num("BASE_SWAP_FEE_TIER", 10000),
    /** Slippage tolerance for swaps, in percent. */
    slippagePct: num("SWAP_SLIPPAGE_PCT", 8),
    /** The launched $THESIS token contract (for buyback & burn). */
    thesisToken: str("THESIS_TOKEN_ADDRESS"),
    /** Where bought-back $THESIS is sent to be burned. */
    burnAddress: str("BURN_ADDRESS", "0x000000000000000000000000000000000000dEaD"),
    /** 0x Swap API key. With this, swaps route through 0x's aggregator
     *  (Uniswap v2/v3/v4, Aerodrome, 150+ DEXes) instead of direct Uniswap v3.
     *  Get a free key at https://dashboard.0x.org/. */
    zeroExApiKey: str("ZEROEX_API_KEY"),
  },

  /** Solana support — ADDITIVE and OPTIONAL. Defaults keep the system in mock
   *  mode with no Solana wallet; a Solana win only needs these when trading
   *  live on Solana. The global `chain.liveTradingArmed` gate also guards
   *  real Solana swaps — there is one arm switch for both chains. */
  solana: {
    /** Solana RPC endpoint. Public mainnet RPC by default; use a paid RPC
     *  (Helius / QuickNode) for live trading to avoid rate limits. */
    rpcUrl: str("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com"),
    /** base58-encoded secret key for the Solana trading wallet. Separate from
     *  the EVM wallet — Solana wins trade and pay out from this wallet. */
    tradingWalletKey: str("SOLANA_TRADING_WALLET_KEY"),
    /** Where a Solana win's 25% buyback slice accrues. There is no $THESIS on
     *  Solana to burn, so this leg sends the SOL to a dedicated collection
     *  wallet for a later manual bridge → buyback → burn (phase 2). */
    buybackWallet: str("SOLANA_BUYBACK_WALLET"),
    /** Jupiter aggregator API base (v6 quote + swap). */
    jupiterApiBase: str("JUPITER_API_BASE", "https://quote-api.jup.ag/v6"),
    /** Slippage tolerance for Jupiter swaps, in percent. */
    slippagePct: num("SOLANA_SLIPPAGE_PCT", 8),
    /** Wrapped-SOL mint — Jupiter's input/output sentinel for native SOL. */
    wsolMint: str("SOLANA_WSOL_MINT", "So11111111111111111111111111111111111111112"),
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
    /** Optional IP allow-list for /admin/* — comma-separated. EMPTY (default)
     *  means no IP restriction, so existing deployments are unaffected. Set to
     *  e.g. "127.0.0.1,::1" to make the admin endpoints reachable only from
     *  localhost (use an SSH tunnel to drive them remotely). */
    adminAllowedIps: str("ADMIN_ALLOWED_IPS")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  },

  chatbot: {
    /** Whether the LLM chatbot answers non-thesis mentions ("what is this",
     *  "how do I submit", etc.). Set CHATBOT_ENABLED=false to silence it. */
    enabled: str("CHATBOT_ENABLED", "true") !== "false",
  },

  telegram: {
    botToken: str("TELEGRAM_BOT_TOKEN"),
    /** Set TELEGRAM_ENABLED=false to disable the bot entirely. */
    enabled: str("TELEGRAM_ENABLED", "true") !== "false",
    /** Comma-separated list of Telegram chat IDs allowed to interact. */
    allowedChats: str("TELEGRAM_ALLOWED_CHATS")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    pollIntervalSec: num("TELEGRAM_POLL_INTERVAL_SEC", 30),
    group: {
      /** Separate public-group bot. Self-disables if token/chat absent (mock-safe). */
      enabled: str("TELEGRAM_GROUP_ENABLED", "true") !== "false",
      botToken: str("TELEGRAM_GROUP_BOT_TOKEN"),
      chatId: str("TELEGRAM_GROUP_CHAT_ID"),
    },
  },

  observability: {
    /** Seconds before heartbeat is considered stale. 0 = auto-derive from poll interval. */
    heartbeatStaleSec: num("HEARTBEAT_STALE_SEC", 0),
    /** How many recent events to keep in memory. */
    recentBufferSize: num("OBS_RECENT_BUFFER_SIZE", 200),
    /** Maximum rows retained in the durable Event table (Prisma sink). Oldest
     *  rows are pruned when the cap is exceeded. 50 000 ≈ weeks of headroom. */
    eventLogCap: num("OBS_EVENT_LOG_CAP", 50_000),
  },

  service: {
    /** How often to poll X for new mentions (seconds). */
    pollIntervalSec: num("POLL_INTERVAL_SEC", 300),
    /** How often the review loop pulls the next submission from the queue. */
    reviewIntervalSec: num("REVIEW_INTERVAL_SEC", 20),
    /** How often to check open positions for TP / SL. */
    monitorIntervalSec: num("MONITOR_INTERVAL_SEC", 15),
    /** Where the store keeps its data (JSON file or SQLite db). */
    dataDir: str("DATA_DIR", "./data"),
    /** Which persistence backend getStore() builds. "file" (default) is the
     *  JSON file store — the canonical, battle-tested path the whole backend
     *  suite runs against and where production data already lives. Set
     *  THESIS_STORE=sqlite to opt into the Prisma/SQLite store instead. */
    store: str("THESIS_STORE", "file"),
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
    /** Extra addresses the committee will never review (in addition to its own
     *  $THESIS and team wallet, which are auto-included). Comma-separated. */
    selfBlacklist: str("SELF_BLACKLIST")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
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

/** True when Solana trading is configured — i.e. a Solana trading wallet key is
 *  present. The launch posture (Option A) ships WITHOUT one, so this is false and
 *  a Solana CA is declined at triage with a "coming soon" reply rather than
 *  reviewed/traded. Base is unaffected. Setting SOLANA_TRADING_WALLET_KEY later
 *  flips Solana on with no code change. */
export function solanaTradingEnabled(): boolean {
  return config.solana.tradingWalletKey.trim().length > 0;
}

/** Thrown by {@link validateConfig} when the loaded config is unusable. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Fail-fast configuration check — run once at boot (see src/index.ts), BEFORE
 * the server or service loops start.
 *
 * `num()` is `Number(v)`, which silently yields NaN for a typo'd env var
 * ("3o" → NaN). A NaN threshold poisons every comparison: `price <= NaN` is
 * always false, so a NaN STOP_LOSS_PCT means the stop-loss NEVER fires and the
 * bot rides a losing trade to zero — invisibly. This gate turns that silent NaN
 * (plus out-of-range, contradictory, and live-without-a-key configs) into a loud
 * refusal to start.
 *
 * It collects ALL problems and throws them together, so one boot tells the
 * operator everything that is wrong rather than one-error-per-restart.
 */
export function validateConfig(): void {
  const problems: string[] = [];

  // Show the operator the raw env value that failed (or that it was unset),
  // not just the parsed NaN — that is what makes the typo obvious.
  const raw = (key: string): string => {
    const v = process.env[key];
    return v === undefined ? "<unset>" : `"${v}"`;
  };
  /** Require a finite number within [min, max] (inclusive). */
  const range = (key: string, v: number, min: number, max: number): void => {
    if (!Number.isFinite(v)) {
      problems.push(`${key}: must be a finite number (got ${raw(key)})`);
    } else if (v < min || v > max) {
      problems.push(`${key}: must be between ${min} and ${max} (got ${v})`);
    }
  };

  const BIG = Number.MAX_SAFE_INTEGER;
  const DAY_SEC = 86_400;
  const HOURS_PER_YEAR = 8_760;

  // --- numeric finiteness + sane ranges -----------------------------------
  // server / chain
  range("PORT", config.server.port, 1, 65_535);
  range("BASE_CHAIN_ID", config.chain.chainId, 1, BIG);
  range("BASE_SWAP_FEE_TIER", config.chain.feeTier, 1, 1_000_000);
  range("SWAP_SLIPPAGE_PCT", config.chain.slippagePct, 0, 100);
  // Solana (optional) — only the slippage knob can silently NaN-poison a swap;
  // the wallet/RPC are checked lazily by the Solana adapter when it trades.
  range("SOLANA_SLIPPAGE_PCT", config.solana.slippagePct, 0, 100);

  // service loop intervals — 0 would hot-loop the self-rescheduling loops.
  range("POLL_INTERVAL_SEC", config.service.pollIntervalSec, 1, DAY_SEC);
  range("REVIEW_INTERVAL_SEC", config.service.reviewIntervalSec, 1, DAY_SEC);
  range("MONITOR_INTERVAL_SEC", config.service.monitorIntervalSec, 1, DAY_SEC);

  // auditor gates
  range("MIN_TOKEN_AGE_HOURS", config.auditor.minTokenAgeHours, 0, HOURS_PER_YEAR);
  range("MAX_TOP10_PCT", config.auditor.maxTop10Pct, 0, 100);
  range("MIN_MARKET_CAP_USD", config.auditor.minMarketCapUsd, 0, BIG);
  range("MAX_MARKET_CAP_USD", config.auditor.maxMarketCapUsd, 0, BIG);

  // triage gates
  range("MIN_AUTHOR_FOLLOWERS", config.triage.minAuthorFollowers, 0, BIG);
  range("MIN_THESIS_WORDS", config.triage.minThesisWords, 0, 10_000);
  range("AUTHOR_COOLDOWN_HOURS", config.triage.authorCooldownHours, 0, HOURS_PER_YEAR);
  range("CONTRACT_DEDUP_HOURS", config.triage.contractDedupHours, 0, HOURS_PER_YEAR);
  range("REVIEW_BUDGET_PER_HOUR", config.triage.reviewBudgetPerHour, 0, BIG);
  range("QUEUE_TTL_MIN", config.triage.queueTtlMin, 0, BIG);

  // trading — the money-affecting knobs
  range("POSITION_SIZE_MIN_PCT", config.trading.positionSizeMinPct, 0, 100);
  range("POSITION_SIZE_MAX_PCT", config.trading.positionSizeMaxPct, 0, 100);
  range("STOP_LOSS_PCT", config.trading.stopLossPct, 0, 100);
  range("MAX_BUYS_PER_DAY", config.trading.maxBuysPerDay, 0, 100_000);
  range("BUY_COOLDOWN_MINUTES", config.trading.buyCooldownMinutes, 0, 7 * DAY_SEC / 60);

  // --- cross-field invariants ---------------------------------------------
  // Only meaningful when both sides parsed — the range() checks above already
  // flagged any NaN, so guard on finiteness to avoid a confusing NaN-vs-NaN
  // comparison message on top of the real error.
  const { positionSizeMinPct, positionSizeMaxPct } = config.trading;
  if (
    Number.isFinite(positionSizeMinPct) &&
    Number.isFinite(positionSizeMaxPct) &&
    positionSizeMinPct > positionSizeMaxPct
  ) {
    problems.push(
      `POSITION_SIZE_MIN_PCT (${positionSizeMinPct}) must be <= POSITION_SIZE_MAX_PCT (${positionSizeMaxPct})`,
    );
  }
  const { minMarketCapUsd, maxMarketCapUsd } = config.auditor;
  if (
    Number.isFinite(minMarketCapUsd) &&
    Number.isFinite(maxMarketCapUsd) &&
    minMarketCapUsd > maxMarketCapUsd
  ) {
    problems.push(
      `MIN_MARKET_CAP_USD (${minMarketCapUsd}) must be <= MAX_MARKET_CAP_USD (${maxMarketCapUsd})`,
    );
  }

  // --- live-mode required secrets -----------------------------------------
  // In mock mode every field has a safe default; live mode moves real ETH, so
  // the things that make trading possible must actually be present.
  if (config.mode === "live") {
    if (!config.chain.tradingWalletKey) {
      problems.push(
        "THESIS_MODE=live requires TRADING_WALLET_PRIVATE_KEY (no wallet key = cannot sign trades)",
      );
    }
    if (!config.chain.rpcUrl) {
      problems.push("THESIS_MODE=live requires BASE_RPC_URL");
    }
  }

  if (problems.length > 0) {
    throw new ConfigError(
      `Invalid configuration — refusing to start:\n  - ${problems.join("\n  - ")}`,
    );
  }
}
