/**
 * One-off wind-down: SELL every open position on BOTH chains, keep ALL proceeds
 * in the trading wallet, and distribute NOTHING.
 *
 * Context: the project is being shut down. We want a clean, simple exit — sell
 * the remaining bag of every open position back to native (ETH on Base via
 * KyberSwap, SOL on Solana via Jupiter), and then STOP. Crucially this is NOT
 * the normal close pipeline: there is NO 25/50/25 split — no buyback/burn, no
 * author payout, no escrow, no Distribution row, no X/Telegram announcement.
 * The native proceeds simply land in the trading wallet and stay there.
 *
 * How "no distribution" is guaranteed: instead of calling the monitor's
 * settle(), this script marks each sold position `closed` AND stamps `settledAt`
 * (+ a fully-done `settlement` progress). settle() is a no-op once `settledAt`
 * is set (monitor/index.ts), and getUnsettledClosedPositions() filters on
 * `settledAt: null` — so even if the backend is ever restarted, the monitor's
 * resume pass will never pick these up and never distribute.
 *
 * ── SAFETY ────────────────────────────────────────────────────────────────
 *   • DRY-RUN BY DEFAULT. Quotes each position via quoteSell and prints what it
 *     WOULD sell. Writes nothing, sends nothing on-chain.
 *   • `--execute` is REQUIRED to perform real swaps + state writes.
 *   • REFUSES --execute in mock mode.
 *   • Writes a timestamped audit JSON of every {id, proceeds, txHash} as it goes.
 *   • Idempotent: skips positions already `closed`. A position whose sell
 *     reverts (illiquid/dust) is LEFT OPEN and reported — just re-run.
 *   • Sequential (one sell at a time) so wallet nonce / Jito ordering is clean.
 *   • BACK UP THE DB FIRST: cp <data>/thesis.db <data>/thesis.db.bak
 *
 * ── RUN (prod env: DATABASE_URL, THESIS_STORE=sqlite, THESIS_MODE=live, both
 *        wallet keys + RPCs set; backend pm2 process STOPPED first) ───────────
 *   tsx --env-file-if-exists=../../.env scripts/winddown-liquidate.ts            # dry-run
 *   tsx --env-file-if-exists=../../.env scripts/winddown-liquidate.ts --execute  # real sells
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Chain, Position } from "@thesis/shared";
import { config, useMock } from "../src/config.js";
import { getStore } from "../src/store/index.js";
import { createChainAdapter } from "../src/adapters/chain/index.js";
import { tokensRemaining } from "../src/domain/sizing.js";
import { nativeSymbol } from "../src/util/chains.js";

interface ResultRow {
  id: string;
  chain: Chain;
  author: string;
  ca: string;
  tokens: number;
  cost: number;
  proceeds: number | null;
  profit: number | null;
  txHash: string | null;
  outcome: "SOLD" | "QUOTED" | "NO-TOKENS" | "REVERTED" | "ERROR";
  note: string;
}

/** Mark a position terminally closed with NO distribution (settledAt stamped). */
function markClosedNoDistribution(pos: Position, proceeds: number, tokens: number, txHash: string | null): void {
  const cost = pos.order.amountInEth * pos.remainingFraction;
  pos.realisedPnlEth += proceeds - cost;
  pos.remainingFraction = 0;
  pos.status = "closed";
  if (txHash) {
    pos.lastExitPriceEth = tokens > 0 ? proceeds / tokens : pos.lastExitPriceEth;
    pos.lastExitTxHash = txHash;
  }
  const now = new Date().toISOString();
  pos.closedAt = pos.closedAt ?? now;
  // The master "no distribution" gate: settle() is a no-op when settledAt is set,
  // and the monitor's resume pass excludes settledAt!=null. Belt-and-suspenders:
  // mark every settlement leg done so nothing can re-open the split.
  pos.settledAt = now;
  pos.settlement = { authorDone: true, buybackDone: true, distributionDone: true };
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const mode = execute ? "EXECUTE (real swaps + writes)" : "DRY-RUN (quotes only, read-only)";

  console.log("──────────────────────────────────────────────────────────────");
  console.log(` winddown-liquidate  ·  ${mode}`);
  console.log(`  store      : ${config.service.store}`);
  console.log(`  chain mode : ${useMock() ? "MOCK ⚠️" : "live"}`);
  try {
    console.log(`  base wallet  : ${createChainAdapter("base").getWalletAddress()}`);
  } catch { /* ignore */ }
  try {
    console.log(`  solana wallet: ${createChainAdapter("solana").getWalletAddress()}`);
  } catch { /* ignore */ }
  console.log("──────────────────────────────────────────────────────────────");

  if (execute && useMock()) {
    console.error("REFUSING --execute in mock mode (would not touch the real wallet). Aborting.");
    process.exit(1);
  }

  const store = getStore();
  const open = (await getStore().getAllPositions()).filter((p) => p.status === "open");
  // Process Solana first then Base (arbitrary, just deterministic); sequential.
  const ordered = [...open].sort((a, b) => a.order.chain.localeCompare(b.order.chain));

  console.log(`Open positions to liquidate: ${open.length}`);
  const byChain = new Map<Chain, number>();
  for (const p of open) byChain.set(p.order.chain, (byChain.get(p.order.chain) ?? 0) + 1);
  for (const [c, n] of byChain) console.log(`  ${c}: ${n}`);
  console.log("");

  if (open.length === 0) {
    console.log("Nothing open. Done.");
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const auditPath = join(config.service.dataDir, `winddown-audit-${stamp}.json`);
  const rows: ResultRow[] = [];

  const flush = (): void => {
    try {
      writeFileSync(auditPath, JSON.stringify(rows, null, 2));
    } catch (e) {
      console.error(`  (audit write failed: ${String(e)})`);
    }
  };

  for (const pos of ordered) {
    const chain = pos.order.chain;
    const sym = nativeSymbol(chain);
    const tokens = tokensRemaining(pos);
    const cost = pos.order.amountInEth * pos.remainingFraction;
    const row: ResultRow = {
      id: pos.id,
      chain,
      author: pos.authorHandle,
      ca: pos.order.contractAddress,
      tokens,
      cost,
      proceeds: null,
      profit: null,
      txHash: null,
      outcome: "ERROR",
      note: "",
    };

    if (tokens <= 0) {
      // No bag to sell (already fully exited / dust). Just close it terminally.
      row.outcome = "NO-TOKENS";
      row.note = "no remaining tokens — marked closed (no sell)";
      if (execute) {
        markClosedNoDistribution(pos, 0, 0, null);
        await store.savePosition(pos);
      }
      console.log(`[${row.outcome}] ${pos.id} ${chain} ${pos.authorHandle} — ${row.note}`);
      rows.push(row);
      flush();
      continue;
    }

    if (!execute) {
      // DRY-RUN: quote what the sell would realize, write nothing.
      try {
        const { proceedsEth } = await createChainAdapter(chain).quoteSell(pos.order.contractAddress, tokens);
        row.proceeds = proceedsEth;
        row.profit = proceedsEth - cost;
        row.outcome = "QUOTED";
        row.note = "dry-run quote";
      } catch (err) {
        row.outcome = "ERROR";
        row.note = `quote failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      console.log(
        `[${row.outcome}] ${pos.id} ${chain} ${pos.authorHandle}  ` +
          `tokens=${tokens.toExponential(3)}  ~proceeds=${row.proceeds?.toFixed(5) ?? "—"} ${sym}  ` +
          `(cost ${cost.toFixed(5)} ${sym}, ${row.note})`,
      );
      rows.push(row);
      flush();
      continue;
    }

    // EXECUTE: real on-chain sell of the full remaining bag, patient retries.
    try {
      const sale = await createChainAdapter(chain).sell(pos.order.contractAddress, tokens, {
        maxAttempts: 3,
        delayBetweenMs: 20_000,
      });
      row.proceeds = sale.amountOut;
      row.profit = sale.amountOut - cost;
      row.txHash = sale.txHash;
      row.outcome = "SOLD";
      markClosedNoDistribution(pos, sale.amountOut, tokens, sale.txHash);
      await store.savePosition(pos);
      console.log(
        `[SOLD] ${pos.id} ${chain} ${pos.authorHandle}  ` +
          `proceeds=${sale.amountOut.toFixed(5)} ${sym} (profit ${(row.profit >= 0 ? "+" : "")}${row.profit.toFixed(5)})  ` +
          `tx ${sale.txHash}  → closed, NO distribution`,
      );
    } catch (err) {
      row.outcome = "REVERTED";
      row.note = `sell reverted — LEFT OPEN, re-run to retry: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[REVERTED] ${pos.id} ${chain} ${pos.authorHandle} — ${row.note}`);
    }
    rows.push(row);
    flush();
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n──────────────────────────────────────────────────────────────");
  const sold = rows.filter((r) => r.outcome === "SOLD");
  const quoted = rows.filter((r) => r.outcome === "QUOTED");
  const closedEmpty = rows.filter((r) => r.outcome === "NO-TOKENS");
  const reverted = rows.filter((r) => r.outcome === "REVERTED");
  const errored = rows.filter((r) => r.outcome === "ERROR");

  const proceedsByChain = new Map<Chain, number>();
  for (const r of [...sold, ...quoted]) {
    if (r.proceeds != null) proceedsByChain.set(r.chain, (proceedsByChain.get(r.chain) ?? 0) + r.proceeds);
  }
  console.log(execute ? "EXECUTED:" : "DRY-RUN summary:");
  console.log(
    `  sold ${sold.length} · quoted ${quoted.length} · empty-closed ${closedEmpty.length} · ` +
      `reverted ${reverted.length} · errored ${errored.length}`,
  );
  for (const [c, total] of proceedsByChain) {
    console.log(`  ${execute ? "proceeds into wallet" : "expected proceeds"} (${c}): ${total.toFixed(5)} ${nativeSymbol(c)}`);
  }
  console.log(`  audit: ${auditPath}`);
  console.log("  distribution: NONE (no buyback/burn, no author payout, no escrow, no Distribution rows).");
  console.log("──────────────────────────────────────────────────────────────");
  if (!execute) {
    console.log("\nDRY-RUN — nothing sold, nothing written. Re-run with --execute to liquidate for real.");
  } else if (reverted.length || errored.length) {
    console.log(`\n⚠️  ${reverted.length + errored.length} position(s) did NOT sell and were LEFT OPEN. Re-run --execute to retry.`);
  } else {
    console.log("\nAll open positions liquidated. Proceeds sit in the trading wallets. Nothing distributed.");
  }
}

main().catch((err) => {
  console.error("winddown-liquidate failed:", err);
  process.exit(1);
});
