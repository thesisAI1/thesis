/**
 * HTTP server — serves the website and the public transparency API.
 *
 * There is no author registration here: payouts are handled entirely on X
 * (see ../payout). The server is read-only — it exposes the trade record and
 * the live agent stream, nothing that mutates state.
 *
 * Routes:
 *   GET   /                  static site (packages/website/public)
 *   GET   /docs              the documentation page (docs.html)
 *   GET   /leaderboard       the author leaderboard page (leaderboard.html)
 *   GET   /pitch             the submission requirements page (pitch.html)
 *   GET   /api/status        service status JSON
 *   GET   /api/dashboard     the full transparency payload
 *   GET   /api/leaderboard   author ranking by realised author share
 *   GET   /api/stream        Server-Sent Events — the live agent stream
 *   POST  /admin/test-swap            manual smoke-test of the live swap path
 *                                     (gated by ADMIN_SECRET header)
 *   POST  /admin/settle-stuck-payout  pay out an author whose escrow grew
 *                                     after a payout but no new request was
 *                                     posted (gated by ADMIN_SECRET header)
 *   POST  /admin/reset-position-state clear fake TP state from a position
 *                                     after a silent sell failure
 *                                     (gated by ADMIN_SECRET header)
 *   POST  /admin/rebuy-position       re-open a closed position by buying
 *                                     the token again with the same ETH
 *                                     amount (gated by ADMIN_SECRET header)
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createChainAdapter } from "../adapters/chain/index.js";
import { createBaseDataAdapter } from "../adapters/basedata/index.js";
import { createXAdapter } from "../adapters/x/index.js";
import { config } from "../config.js";
import { subscribe, type StreamEvent } from "../events.js";
import { getStore } from "../store/index.js";
import { log } from "../util/log.js";
import { payoutSentText } from "../util/replies.js";

/** Process-lifetime cache of token tickers (DexScreener calls). Tickers are
 *  immutable for a given contract, so first lookup is the only network hit. */
const symbolCache = new Map<string, string>();
async function getSymbolCached(address: string): Promise<string> {
  const key = address.toLowerCase();
  const hit = symbolCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const sym = await createBaseDataAdapter().getTokenSymbol(address);
    symbolCache.set(key, sym);
    return sym;
  } catch {
    return "";
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const WEBROOT = resolve(HERE, "../../../website/public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** Start the HTTP server. */
export function startServer(): void {
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      log.error(`server: ${String(err)}`);
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
    });
  });
  server.listen(config.server.port, () => {
    log.info(`server: listening on ${config.server.publicBaseUrl}`);
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", config.server.publicBaseUrl);
  const path = url.pathname;

  if (path === "/api/status") return apiStatus(res);
  if (path === "/api/dashboard") return apiDashboard(res);
  if (path === "/api/leaderboard") return apiLeaderboard(res);
  if (path === "/api/stream") return apiStream(req, res);
  if (path === "/admin/test-swap" && req.method === "POST") return adminTestSwap(req, res);
  if (path === "/admin/settle-stuck-payout" && req.method === "POST") return adminSettleStuckPayout(req, res);
  if (path === "/admin/reset-position-state" && req.method === "POST") return adminResetPositionState(req, res);
  if (path === "/admin/rebuy-position" && req.method === "POST") return adminRebuyPosition(req, res);
  if (path === "/admin/backfill-entry-mc" && req.method === "POST") return adminBackfillEntryMc(req, res);

  // Clean URL for the documentation page.
  if (path === "/docs") return serveStatic("/docs.html", res);
  if (path === "/leaderboard") return serveStatic("/leaderboard.html", res);
  if (path === "/pitch") return serveStatic("/pitch.html", res);

  return serveStatic(path, res);
}

/**
 * POST /admin/test-swap — manual smoke test of the live swap path.
 *
 * Auth: header `x-admin-secret` must match config.server.adminSecret. If
 * ADMIN_SECRET is not set, the endpoint is disabled.
 *
 * Body (JSON):
 *   { tokenAddress: "0x…", amountEth: 0.0001 }
 *
 * Calls chain.buy directly — the same code path the Bursar uses for real
 * BUY decisions, including all the LIVE_TRADING_ARMED gating.
 *
 * Returns: { ok, txHash, amountOut, priceEth, basescanUrl }
 */
async function adminTestSwap(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const secret = config.server.adminSecret;
  if (!secret) {
    return sendJson(res, 503, {
      ok: false,
      error: "ADMIN_SECRET is not set — test endpoint disabled.",
    });
  }
  if (req.headers["x-admin-secret"] !== secret) {
    return sendJson(res, 401, { ok: false, error: "unauthorized" });
  }
  let body: { tokenAddress?: string; amountEth?: number };
  try {
    body = JSON.parse(await readBody(req)) as typeof body;
  } catch {
    return sendJson(res, 400, { ok: false, error: "invalid JSON body" });
  }
  const tokenAddress = body.tokenAddress?.trim();
  const amountEth = Number(body.amountEth);
  if (!tokenAddress || !/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
    return sendJson(res, 400, { ok: false, error: "tokenAddress must be a 0x address" });
  }
  if (!Number.isFinite(amountEth) || amountEth <= 0 || amountEth > 0.01) {
    return sendJson(res, 400, {
      ok: false,
      error: "amountEth must be a positive number ≤ 0.01 (smoke-test cap)",
    });
  }
  log.info(`admin: test-swap requested — ${amountEth} ETH -> ${tokenAddress}`);
  try {
    const chain = createChainAdapter();
    const result = await chain.buy(tokenAddress, amountEth);
    sendJson(res, 200, {
      ok: true,
      txHash: result.txHash,
      amountOut: result.amountOut,
      priceEth: result.priceEth,
      basescanUrl: `https://basescan.org/tx/${result.txHash}`,
    });
  } catch (err) {
    log.error(`admin: test-swap failed — ${String(err)}`);
    sendJson(res, 500, { ok: false, error: String(err) });
  }
}

/**
 * POST /admin/settle-stuck-payout — manually pay an author whose escrow grew
 * after a payout completed but no new request was posted (the silent-return
 * bug in requestAuthorPayout, fixed but historical cases need manual fix).
 *
 * Auth: header `x-admin-secret` must match config.server.adminSecret.
 *
 * Body (JSON):
 *   {
 *     xUserId:   "2058...",        // numeric X id of the author
 *     wallet:    "0x...",          // wallet to send the escrow to
 *     handle:    "@user",          // (optional) used only when no escrow exists
 *     amountEth: 0.0046,           // (optional) override — paid when no escrow record exists
 *     postId:    "20594...",       // (optional) thesis post id to reply on
 *   }
 *
 * Behaviour:
 *   1. Looks up the escrow for xUserId; falls back to `amountEth` override if missing
 *   2. Sends the ETH to `wallet`
 *   3. Links the wallet into the registry (so future settlements pay directly)
 *   4. Clears the escrow + every open payout request for that user
 *   5. Posts a payout-sent confirmation reply on the given `postId`
 *
 * Returns: { ok, txHash, amountEth, basescanUrl, replyId? }
 */
async function adminSettleStuckPayout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const secret = config.server.adminSecret;
  if (!secret) {
    return sendJson(res, 503, { ok: false, error: "ADMIN_SECRET is not set — endpoint disabled." });
  }
  if (req.headers["x-admin-secret"] !== secret) {
    return sendJson(res, 401, { ok: false, error: "unauthorized" });
  }
  let body: {
    xUserId?: string;
    wallet?: string;
    handle?: string;
    amountEth?: number;
    postId?: string;
  };
  try {
    body = JSON.parse(await readBody(req)) as typeof body;
  } catch {
    return sendJson(res, 400, { ok: false, error: "invalid JSON body" });
  }
  const xUserId = body.xUserId?.trim();
  const wallet = body.wallet?.trim();
  const postId = body.postId?.trim();
  if (!xUserId) return sendJson(res, 400, { ok: false, error: "xUserId is required" });
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return sendJson(res, 400, { ok: false, error: "wallet must be a 0x address" });
  }

  const store = getStore();
  // Prefer the escrow record (real, tracked, comes from a real settlement).
  // Fall back to the `amountEth` body override for cases where the author leg
  // failed BEFORE escrow was created (e.g. a payAuthorDirect tx revert).
  const escrow = await store.getEscrow(xUserId);
  let amountEth: number;
  let handle: string;
  if (escrow && escrow.amountEth > 0) {
    amountEth = escrow.amountEth;
    handle = escrow.handle;
  } else {
    const overrideAmount = Number(body.amountEth);
    if (!Number.isFinite(overrideAmount) || overrideAmount <= 0 || overrideAmount > 1) {
      return sendJson(res, 400, {
        ok: false,
        error: "no escrow found — supply a positive `amountEth` (≤ 1 ETH safety cap) and `handle`",
      });
    }
    if (!body.handle) {
      return sendJson(res, 400, { ok: false, error: "supply `handle` when overriding amountEth" });
    }
    amountEth = overrideAmount;
    handle = body.handle;
  }

  log.info(
    `admin: settle-stuck-payout — paying ${handle} ${amountEth.toFixed(6)} ETH to ${wallet}`,
  );

  let txHash: string;
  try {
    txHash = await createChainAdapter().sendEth(wallet, amountEth);
  } catch (err) {
    log.error(`admin: settle-stuck-payout sendEth failed — ${String(err)}`);
    return sendJson(res, 500, { ok: false, error: String(err) });
  }

  // Persist the wallet and clear all owed state so future settlements pay direct.
  await store.linkWallet({
    xUserId,
    handle,
    wallet,
    linkedAt: new Date().toISOString(),
  });
  await store.clearEscrow(xUserId);
  await store.clearPayoutRequestsForUser(xUserId);
  log.info(`admin: settle-stuck-payout — cleared escrow + open requests for ${handle}`);

  // Confirm in the thesis thread if a postId was provided.
  let replyId: string | undefined;
  if (postId) {
    try {
      replyId = await createXAdapter().replyToPost(
        postId,
        payoutSentText({ handle, amountEth, wallet, txHash }),
      );
      log.info(`admin: posted payout confirmation on ${postId} (reply ${replyId})`);
    } catch (err) {
      log.warn(`admin: settle-stuck-payout reply failed — ${String(err)}`);
    }
  }

  sendJson(res, 200, {
    ok: true,
    handle,
    amountEth,
    txHash,
    basescanUrl: `https://basescan.org/tx/${txHash}`,
    replyId: replyId ?? null,
  });
}

/**
 * POST /admin/reset-position-state — clear corrupted TP state from a position
 * after a silent sell failure (pre-fix bug that recorded fake TP hits with
 * empty tx hashes). Resets tiersHit, realisedPnLEth, and the lastExit fields
 * so the monitor will retry the tier cleanly on the next price-check tick.
 *
 * Body (JSON): { positionId: "20594..." }
 *
 * Returns: { ok, position: { id, tiersHit, realisedPnlEth, ... } }
 */
async function adminResetPositionState(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const secret = config.server.adminSecret;
  if (!secret) {
    return sendJson(res, 503, { ok: false, error: "ADMIN_SECRET is not set" });
  }
  if (req.headers["x-admin-secret"] !== secret) {
    return sendJson(res, 401, { ok: false, error: "unauthorized" });
  }
  let body: { positionId?: string };
  try {
    body = JSON.parse(await readBody(req)) as typeof body;
  } catch {
    return sendJson(res, 400, { ok: false, error: "invalid JSON body" });
  }
  const positionId = body.positionId?.trim();
  if (!positionId) return sendJson(res, 400, { ok: false, error: "positionId is required" });

  const store = getStore();
  const positions = await store.getAllPositions();
  const pos = positions.find((p) => p.id === positionId);
  if (!pos) return sendJson(res, 404, { ok: false, error: "position not found" });

  const before = {
    tiersHit: pos.tiersHit,
    realisedPnlEth: pos.realisedPnlEth,
    remainingFraction: pos.remainingFraction,
    lastExitTxHash: pos.lastExitTxHash,
    status: pos.status,
  };

  pos.tiersHit = 0;
  pos.realisedPnlEth = 0;
  pos.remainingFraction = 1;
  pos.lastExitTxHash = undefined;
  pos.lastExitPriceEth = undefined;
  pos.status = "open";
  pos.closedAt = undefined;
  await store.savePosition(pos);

  log.info(`admin: reset position state for ${positionId} (was ${JSON.stringify(before)})`);
  sendJson(res, 200, {
    ok: true,
    positionId,
    before,
    after: {
      tiersHit: pos.tiersHit,
      realisedPnlEth: pos.realisedPnlEth,
      remainingFraction: pos.remainingFraction,
      status: pos.status,
    },
  });
}

/**
 * POST /admin/rebuy-position — manually re-open a closed position by buying
 * the token again with the SAME ETH amount as the original buy. Used to
 * honour an author whose position was wrongly closed by a bug (fake TP1,
 * silent sell failure, etc.) and we want to give the thesis another shot
 * without faking the entry price.
 *
 * Auth: header `x-admin-secret`.
 *
 * Body (JSON): { positionId: "pos-..." }
 *
 * Behaviour:
 *   1. Loads the position; fails if not found.
 *   2. Calls chain.buy(token, position.order.amountInEth) — real on-chain spend.
 *   3. Replaces entryPriceEth / entryTxHash / openedAt with the new buy data;
 *      resets tiersHit, realisedPnlEth, remainingFraction, lastExit fields;
 *      flips status back to "open".
 *
 * Returns: { ok, positionId, oldEntryPriceEth, newEntryPriceEth, txHash, basescanUrl }
 */
async function adminRebuyPosition(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const secret = config.server.adminSecret;
  if (!secret) return sendJson(res, 503, { ok: false, error: "ADMIN_SECRET is not set" });
  if (req.headers["x-admin-secret"] !== secret) {
    return sendJson(res, 401, { ok: false, error: "unauthorized" });
  }
  let body: { positionId?: string };
  try {
    body = JSON.parse(await readBody(req)) as typeof body;
  } catch {
    return sendJson(res, 400, { ok: false, error: "invalid JSON body" });
  }
  const positionId = body.positionId?.trim();
  if (!positionId) return sendJson(res, 400, { ok: false, error: "positionId is required" });

  const store = getStore();
  const positions = await store.getAllPositions();
  const pos = positions.find((p) => p.id === positionId);
  if (!pos) return sendJson(res, 404, { ok: false, error: "position not found" });

  const amountInEth = pos.order.amountInEth;
  const oldEntryPriceEth = pos.entryPriceEth;
  log.info(
    `admin: rebuy-position ${positionId} — buying ${amountInEth} ETH of ${pos.order.contractAddress}`,
  );

  let buy;
  try {
    buy = await createChainAdapter().buy(pos.order.contractAddress, amountInEth);
  } catch (err) {
    log.error(`admin: rebuy-position buy failed — ${String(err)}`);
    return sendJson(res, 500, { ok: false, error: String(err) });
  }

  pos.entryPriceEth = buy.priceEth;
  pos.entryTxHash = buy.txHash;
  pos.openedAt = new Date().toISOString();
  pos.tiersHit = 0;
  pos.realisedPnlEth = 0;
  pos.remainingFraction = 1;
  pos.lastExitPriceEth = undefined;
  pos.lastExitTxHash = undefined;
  pos.status = "open";
  pos.closedAt = undefined;
  await store.savePosition(pos);

  log.info(
    `admin: rebuy-position ${positionId} — new entry ${buy.priceEth} ETH/tok (was ${oldEntryPriceEth}), tx ${buy.txHash}`,
  );
  sendJson(res, 200, {
    ok: true,
    positionId,
    oldEntryPriceEth,
    newEntryPriceEth: buy.priceEth,
    amountInEth,
    txHash: buy.txHash,
    basescanUrl: `https://basescan.org/tx/${buy.txHash}`,
  });
}

/**
 * POST /admin/backfill-entry-mc — one-time fix for open positions opened before
 * the marketCapAtEntryUsd field existed. Reads the agent's recent X timeline,
 * finds the buy reply we posted for each position (matched by inReplyToId →
 * postId), and parses the "~$XXk market cap" snippet the bot announced at the
 * time. Writes the value back to each position so the dashboard's market-cap
 * column can finally render entry → now for the pre-existing trades.
 *
 * Idempotent: positions that already have marketCapAtEntryUsd are skipped. If
 * a buy reply isn't found in the recent timeline (older than ~100 of our most
 * recent tweets), that position is reported as `missingReply` and left alone.
 */
async function adminBackfillEntryMc(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const secret = config.server.adminSecret;
  if (!secret) return sendJson(res, 503, { ok: false, error: "ADMIN_SECRET is not set" });
  if (req.headers["x-admin-secret"] !== secret) {
    return sendJson(res, 401, { ok: false, error: "unauthorized" });
  }
  if (!config.x.agentUserId) {
    return sendJson(res, 503, { ok: false, error: "X_AGENT_USER_ID is not set" });
  }

  const store = getStore();
  const positions = await store.getOpenPositions();
  const needsBackfill = positions.filter((p) => p.marketCapAtEntryUsd === undefined);
  if (needsBackfill.length === 0) {
    return sendJson(res, 200, { ok: true, updated: 0, message: "nothing to backfill" });
  }

  // Pull the agent's recent timeline (~100 tweets). Every buy reply we ever
  // posted is in here unless it scrolled past the 100-tweet window.
  const x = createXAdapter();
  let timeline: Awaited<ReturnType<typeof x.getUserTimeline>>;
  try {
    timeline = await x.getUserTimeline(config.x.agentUserId);
  } catch (err) {
    return sendJson(res, 502, { ok: false, error: `timeline fetch failed: ${String(err)}` });
  }

  // Index our timeline by the post we were replying to. A single original
  // post can have multiple replies from us (buy + skip + payout), so we keep
  // the one that actually looks like a buy announcement.
  const replyByOriginal = new Map<string, string>();
  for (const t of timeline) {
    if (!t.inReplyToId) continue;
    // Prefer the tweet that contains the buy-reply marker.
    if (/at\s*~?\$/i.test(t.text) && /market\s*cap/i.test(t.text)) {
      replyByOriginal.set(t.inReplyToId, t.text);
    } else if (!replyByOriginal.has(t.inReplyToId)) {
      // Fallback: store anything until we see a better candidate.
      replyByOriginal.set(t.inReplyToId, t.text);
    }
  }

  const updated: Array<{ positionId: string; marketCapAtEntryUsd: number; matched: string }> = [];
  const missingReply: string[] = [];
  const unparsable: Array<{ positionId: string; text: string }> = [];

  for (const pos of needsBackfill) {
    const replyText = replyByOriginal.get(pos.postId);
    if (!replyText) {
      missingReply.push(pos.id);
      continue;
    }
    const parsed = parseEntryMcFromReply(replyText);
    if (parsed === null) {
      unparsable.push({ positionId: pos.id, text: replyText.slice(0, 120) });
      continue;
    }
    pos.marketCapAtEntryUsd = parsed;
    await store.savePosition(pos);
    updated.push({
      positionId: pos.id,
      marketCapAtEntryUsd: parsed,
      matched: replyText.slice(0, 80),
    });
    log.info(`admin: backfilled entry MC for ${pos.id} -> $${parsed}`);
  }

  sendJson(res, 200, {
    ok: true,
    consideredOpen: positions.length,
    needingBackfill: needsBackfill.length,
    updated: updated.length,
    missingReply: missingReply.length,
    unparsable: unparsable.length,
    details: { updated, missingReply, unparsable },
  });
}

/**
 * Extract the entry market cap from the bot's own buy reply text. The reply
 * format is "Bought 0.0315 ETH at ~$118K market cap." — the regex below is
 * tolerant of K / M / B suffixes, decimals, and optional whitespace.
 * Returns the value in USD, or null if no match.
 */
function parseEntryMcFromReply(text: string): number | null {
  const m = text.match(/~?\$([\d]+(?:\.[\d]+)?)\s*([KMB])\b/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!isFinite(value)) return null;
  const suffix = m[2].toUpperCase();
  const mult = suffix === "B" ? 1e9 : suffix === "M" ? 1e6 : 1e3;
  return value * mult;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectBody);
  });
}

async function apiStatus(res: ServerResponse): Promise<void> {
  const all = await getStore().getAllPositions();
  sendJson(res, 200, {
    mode: config.mode,
    openPositions: all.filter((p) => p.status === "open").length,
    totalPositions: all.length,
  });
}

interface OpenPositionView {
  id: string;
  contractAddress: string;
  /** Token ticker — e.g. "DEGEN". Empty when DexScreener doesn't know it yet. */
  tokenSymbol: string;
  authorHandle: string;
  /** X profile image URL of the author (display only). */
  authorAvatarUrl: string | null;
  grade: string | null;
  /** Permalink to the X post that triggered this trade — for the "view tweet" button. */
  postUrl: string | null;
  status: string;
  tiersHit: number;
  tierCount: number;
  remainingPct: number;
  amountInEth: number;
  entryPriceEth: number;
  currentPriceEth: number;
  /** Token market cap in USD at buy time (null if not captured — pre-redesign). */
  marketCapAtEntryUsd: number | null;
  /** Current token market cap in USD, computed from current price × the same
   *  supply ratio captured at entry. Null if entry MC is unknown. */
  marketCapNowUsd: number | null;
  realisedPnlEth: number;
  unrealizedPnlEth: number;
  unrealizedPct: number;
  openedAt: string;
  entryTxHash: string;
}

/** Everything the public transparency dashboard needs, in one payload. */
async function apiDashboard(res: ServerResponse): Promise<void> {
  const store = getStore();
  const chain = createChainAdapter();
  const [positions, reviews, distributions, funnel, queue] = await Promise.all([
    store.getAllPositions(),
    store.getReviews(),
    store.getDistributions(),
    store.getFunnel(),
    store.getQueue(),
  ]);
  const open = positions.filter((p) => p.status === "open");
  const closed = positions.filter((p) => p.status === "closed");
  const gradeByPosition = new Map(
    reviews
      .filter((r) => r.positionId)
      .map((r) => [r.positionId as string, r.grade] as const),
  );
  const postUrlByPosition = new Map(
    reviews
      .filter((r) => r.positionId && r.postUrl)
      .map((r) => [r.positionId as string, r.postUrl] as const),
  );

  // Pre-warm the ticker cache for every position address (parallel; cached).
  const uniqueAddresses = Array.from(
    new Set(positions.map((p) => p.order.contractAddress.toLowerCase())),
  );
  await Promise.all(uniqueAddresses.map((a) => getSymbolCached(a)));

  let balanceEth = 0;
  let walletAddress = "";
  try {
    balanceEth = await chain.getWalletBalanceEth();
  } catch {
    /* leave 0 */
  }
  try {
    walletAddress = chain.getWalletAddress();
  } catch {
    /* leave blank */
  }

  const openPositions: OpenPositionView[] = [];
  for (const p of open) {
    let currentPriceEth = p.entryPriceEth;
    try {
      currentPriceEth = await chain.getTokenPriceEth(p.order.contractAddress);
    } catch {
      /* keep the entry price */
    }
    // Unrealised PnL is measured on the slice still held.
    const remainingCost = p.order.amountInEth * p.remainingFraction;
    const remainingTokens = p.entryPriceEth > 0 ? remainingCost / p.entryPriceEth : 0;
    const unrealizedPnlEth = remainingTokens * currentPriceEth - remainingCost;
    // Current MC = entry MC × (current price / entry price). Token supply is
    // constant for Clanker/Bankr deploys, so price ratio is a clean proxy.
    const marketCapAtEntryUsd = p.marketCapAtEntryUsd ?? null;
    const marketCapNowUsd =
      marketCapAtEntryUsd !== null && p.entryPriceEth > 0
        ? marketCapAtEntryUsd * (currentPriceEth / p.entryPriceEth)
        : null;
    openPositions.push({
      id: p.id,
      contractAddress: p.order.contractAddress,
      tokenSymbol: symbolCache.get(p.order.contractAddress.toLowerCase()) ?? "",
      authorHandle: p.authorHandle,
      authorAvatarUrl: p.authorAvatarUrl ?? null,
      grade: gradeByPosition.get(p.id) ?? null,
      postUrl: postUrlByPosition.get(p.id) ?? p.postUrl ?? null,
      status: p.status,
      tiersHit: p.tiersHit,
      tierCount: p.order.takeProfits.length,
      remainingPct: Math.round(p.remainingFraction * 100),
      amountInEth: p.order.amountInEth,
      entryPriceEth: p.entryPriceEth,
      currentPriceEth,
      marketCapAtEntryUsd,
      marketCapNowUsd,
      realisedPnlEth: p.realisedPnlEth,
      unrealizedPnlEth,
      unrealizedPct: remainingCost > 0 ? (unrealizedPnlEth / remainingCost) * 100 : 0,
      openedAt: p.openedAt,
      entryTxHash: p.entryTxHash,
    });
  }

  const closedPositions = closed
    .map((p) => ({
      id: p.id,
      contractAddress: p.order.contractAddress,
      tokenSymbol: symbolCache.get(p.order.contractAddress.toLowerCase()) ?? "",
      authorHandle: p.authorHandle,
      postUrl: postUrlByPosition.get(p.id) ?? null,
      amountInEth: p.order.amountInEth,
      entryPriceEth: p.entryPriceEth,
      exitPriceEth: p.lastExitPriceEth ?? 0,
      realisedPnlEth: p.realisedPnlEth,
      realisedPct:
        p.order.amountInEth > 0 ? (p.realisedPnlEth / p.order.amountInEth) * 100 : 0,
      tiersHit: p.tiersHit,
      openedAt: p.openedAt,
      closedAt: p.closedAt ?? "",
      entryTxHash: p.entryTxHash,
      exitTxHash: p.lastExitTxHash ?? "",
    }))
    .reverse();

  // Realised PnL accrues on partial exits too — sum across every position.
  const realizedPnlEth = positions.reduce((s, p) => s + p.realisedPnlEth, 0);
  const wins = closed.filter((p) => p.realisedPnlEth > 0).length;
  const dist = distributions.reduce(
    (a, d) => ({
      toAuthors: a.toAuthors + d.toAuthorEth,
      toPortfolio: a.toPortfolio + d.toPortfolioEth,
      toTeam: a.toTeam + d.toTeamEth,
      toBuyback: a.toBuyback + d.toBuybackEth,
    }),
    { toAuthors: 0, toPortfolio: 0, toTeam: 0, toBuyback: 0 },
  );

  sendJson(res, 200, {
    mode: config.mode,
    portfolio: {
      walletAddress,
      balanceEth,
      realizedPnlEth,
      openCount: open.length,
      closedCount: closed.length,
      winCount: wins,
      winRate: closed.length > 0 ? wins / closed.length : 0,
    },
    reviews: {
      total: reviews.length,
      buys: reviews.filter((r) => r.decision === "BUY").length,
      skips: reviews.filter((r) => r.decision === "SKIP").length,
    },
    distributions: { count: distributions.length, ...dist },
    funnel: {
      seen: funnel.seen,
      passed: funnel.passed,
      reviewed: reviews.length,
      queued: queue.length,
    },
    openPositions,
    closedPositions: closedPositions.slice(0, 25),
    recentReviews: reviews.slice(-20).reverse(),
  });
}

interface LeaderboardEntry {
  rank: number;
  xUserId: string;
  authorHandle: string;
  /** X profile image URL (display only). Null when none on file. */
  authorAvatarUrl: string | null;
  submitted: number;
  funded: number;
  closed: number;
  wins: number;
  winRate: number;
  totalEarnedEth: number;
  bestTradePct: number;
}

/**
 * GET /api/leaderboard — author ranking by realised author share.
 *
 * Aggregates positions + reviews + distributions per authorXId. Authors with
 * zero funded positions are excluded so the board reflects real contributions.
 */
async function apiLeaderboard(res: ServerResponse): Promise<void> {
  const store = getStore();
  const [positions, reviews, distributions] = await Promise.all([
    store.getAllPositions(),
    store.getReviews(),
    store.getDistributions(),
  ]);

  // Map positionId → author so distributions can be credited correctly.
  const positionToAuthor = new Map<string, { xUserId: string; handle: string }>();
  for (const p of positions) {
    positionToAuthor.set(p.id, { xUserId: p.authorXId, handle: p.authorHandle });
  }

  interface Agg {
    xUserId: string;
    authorHandle: string;
    authorAvatarUrl: string | null;
    submitted: number;
    funded: number;
    closed: number;
    wins: number;
    totalEarnedEth: number;
    bestTradePct: number;
  }
  const by = new Map<string, Agg>();
  const ensure = (xUserId: string, handle: string, avatarUrl?: string | null): Agg => {
    let row = by.get(xUserId);
    if (!row) {
      row = {
        xUserId,
        authorHandle: handle,
        authorAvatarUrl: avatarUrl ?? null,
        submitted: 0,
        funded: 0,
        closed: 0,
        wins: 0,
        totalEarnedEth: 0,
        bestTradePct: 0,
      };
      by.set(xUserId, row);
    }
    // Prefer the most-recently-seen handle (handles change less often than ids).
    if (handle) row.authorHandle = handle;
    // Prefer the most-recently-seen avatar (newest positions have it).
    if (avatarUrl) row.authorAvatarUrl = avatarUrl;
    return row;
  };

  // Every review counts as a submission; only BUYs count as funded.
  for (const r of reviews) {
    if (!r.authorXId) continue;
    const a = ensure(r.authorXId, r.authorHandle);
    a.submitted += 1;
    if (r.decision === "BUY") a.funded += 1;
  }

  // First pass over ALL positions — pick up avatar URLs from any position
  // (open or closed) the author has on file. Reviews don't carry avatars
  // so positions are the only source for now.
  for (const p of positions) {
    ensure(p.authorXId, p.authorHandle, p.authorAvatarUrl);
  }

  // Closed positions feed wins + best-trade percentage.
  for (const p of positions) {
    if (p.status !== "closed") continue;
    const a = ensure(p.authorXId, p.authorHandle, p.authorAvatarUrl);
    a.closed += 1;
    if (p.realisedPnlEth > 0) a.wins += 1;
    const pct =
      p.order.amountInEth > 0 ? (p.realisedPnlEth / p.order.amountInEth) * 100 : 0;
    if (pct > a.bestTradePct) a.bestTradePct = pct;
  }

  // Distributions credit the author's 25% to whoever sourced the position.
  for (const d of distributions) {
    const owner = positionToAuthor.get(d.positionId);
    if (!owner) continue;
    const a = ensure(owner.xUserId, owner.handle);
    a.totalEarnedEth += d.toAuthorEth ?? 0;
  }

  // Surface only authors who have actually had a position funded.
  const ranked: LeaderboardEntry[] = Array.from(by.values())
    .filter((a) => a.funded > 0)
    .sort((a, b) => {
      if (b.totalEarnedEth !== a.totalEarnedEth) return b.totalEarnedEth - a.totalEarnedEth;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.funded - a.funded;
    })
    .map((a, i) => ({
      rank: i + 1,
      xUserId: a.xUserId,
      authorHandle: a.authorHandle,
      authorAvatarUrl: a.authorAvatarUrl,
      submitted: a.submitted,
      funded: a.funded,
      closed: a.closed,
      wins: a.wins,
      winRate: a.closed > 0 ? a.wins / a.closed : 0,
      totalEarnedEth: a.totalEarnedEth,
      bestTradePct: a.bestTradePct,
    }));

  sendJson(res, 200, {
    mode: config.mode,
    totalAuthors: ranked.length,
    leaderboard: ranked,
  });
}

/** Server-Sent Events — the live agent stream the Faculty Room subscribes to. */
function apiStream(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(": connected\n\n");
  const unsubscribe = subscribe((event: StreamEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(ping);
    unsubscribe();
  });
}

// --- helpers ------------------------------------------------------------

async function serveStatic(path: string, res: ServerResponse): Promise<void> {
  // Drop a query string before resolving the file (used for cache-busting).
  const clean = (path.split("?")[0] ?? path) || "/";
  const full = normalize(join(WEBROOT, clean === "/" ? "/index.html" : clean));
  if (!full.startsWith(WEBROOT) || !existsSync(full)) {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  const body = await readFile(full);
  const ext = extname(full);
  // HTML / JS / CSS change every deploy and must never serve a stale copy.
  // Images and other assets can cache for a few minutes (they rarely change
  // and the cache-busting query string handles the ones that do).
  const noCache = ext === ".html" || ext === ".js" || ext === ".css";
  res.writeHead(200, {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": noCache
      ? "no-store, no-cache, must-revalidate, max-age=0"
      : "public, max-age=300",
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}
