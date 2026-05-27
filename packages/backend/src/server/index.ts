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
 *   GET   /api/status        service status JSON
 *   GET   /api/dashboard     the full transparency payload
 *   GET   /api/stream        Server-Sent Events — the live agent stream
 *   POST  /admin/test-swap            manual smoke-test of the live swap path
 *                                     (gated by ADMIN_SECRET header)
 *   POST  /admin/settle-stuck-payout  pay out an author whose escrow grew
 *                                     after a payout but no new request was
 *                                     posted (gated by ADMIN_SECRET header)
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
  if (path === "/api/stream") return apiStream(req, res);
  if (path === "/admin/test-swap" && req.method === "POST") return adminTestSwap(req, res);
  if (path === "/admin/settle-stuck-payout" && req.method === "POST") return adminSettleStuckPayout(req, res);

  // Clean URL for the documentation page.
  if (path === "/docs") return serveStatic("/docs.html", res);

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
 *     xUserId: "2058...",          // numeric X id of the author
 *     wallet:  "0x...",            // wallet to send the escrow to
 *     postId:  "20594...",         // (optional) the position's thesis post id
 *                                  //   to reply on with the payout confirmation
 *   }
 *
 * Behaviour:
 *   1. Looks up the escrow for xUserId
 *   2. Sends the escrowed ETH to `wallet`
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
  let body: { xUserId?: string; wallet?: string; postId?: string };
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
  const escrow = await store.getEscrow(xUserId);
  if (!escrow || escrow.amountEth <= 0) {
    return sendJson(res, 400, { ok: false, error: "no escrow for this user" });
  }
  const amountEth = escrow.amountEth;
  const handle = escrow.handle;

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
    openPositions.push({
      id: p.id,
      contractAddress: p.order.contractAddress,
      tokenSymbol: symbolCache.get(p.order.contractAddress.toLowerCase()) ?? "",
      authorHandle: p.authorHandle,
      grade: gradeByPosition.get(p.id) ?? null,
      postUrl: postUrlByPosition.get(p.id) ?? null,
      status: p.status,
      tiersHit: p.tiersHit,
      tierCount: p.order.takeProfits.length,
      remainingPct: Math.round(p.remainingFraction * 100),
      amountInEth: p.order.amountInEth,
      entryPriceEth: p.entryPriceEth,
      currentPriceEth,
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
  const full = normalize(join(WEBROOT, path === "/" ? "/index.html" : path));
  if (!full.startsWith(WEBROOT) || !existsSync(full)) {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  const body = await readFile(full);
  res.writeHead(200, {
    "content-type": MIME[extname(full)] ?? "application/octet-stream",
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}
