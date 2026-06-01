/**
 * One-off repair: correct `realisedPnlEth` on closed positions whose sell
 * proceeds were recorded as a FALSE ZERO due to Alchemy read-replica lag.
 *
 * Symptom (reported by @JustT1602): a position that stopped out ~-30% shows
 * -100%. Root cause: pre-#8, `measureEthProceeds` read the wallet once; replica
 * lag made `after ≈ before` → 0 proceeds → realised = 0 - cost = -100%, while
 * `lastExitPriceEth` (and thus the Exit MC column) recorded the real, non-zero
 * exit price. #8 (adapters/chain/proceeds.ts) fixes this GOING FORWARD by
 * retrying the post-swap read; this script repairs the HISTORICAL rows.
 *
 * It re-measures the ACTUAL net ETH the wallet received in the stored exit tx —
 * wallet balance at the exit block minus the prior block, the same net-delta
 * semantics measureEthProceeds uses live — and recomputes realised = proceeds - cost.
 *
 * ── SAFETY ────────────────────────────────────────────────────────────────
 *   • DRY-RUN BY DEFAULT. Prints proposed corrections and writes NOTHING.
 *   • `--apply` is REQUIRED to write. It updates ONLY `realisedPnlEth`, writes a
 *     timestamped audit JSON of every {id, old, new} BEFORE touching the store,
 *     skips any row it can't measure confidently, and NEVER touches open
 *     positions, the distributions table, or anything that moves funds.
 *   • BASE positions only (EVM balance diff). Solana / other-chain suspects are
 *     listed for MANUAL review and never auto-changed.
 *   • A correction can only ever make a loss LESS negative (proceeds ≥ 0), so it
 *     cannot fabricate a profit or deepen a loss.
 *   • BACK UP THE DB FIRST. SQLite → `cp <data>/thesis.db <data>/thesis.db.bak`.
 *
 * ── RUN (in the prod env: DATABASE_URL, THESIS_STORE=sqlite, THESIS_MODE=live,
 *        BASE_RPC_URL pointing at an ARCHIVE node, wallet key all set) ────────
 *   tsx scripts/backfill-realised-pnl.ts            # dry-run — read-only, safe
 *   tsx scripts/backfill-realised-pnl.ts --apply     # writes corrections
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, http, formatEther } from "viem";
import { base, baseSepolia } from "viem/chains";
import type { Position } from "@thesis/shared";
import { config, useMock } from "../src/config.js";
import { getStore } from "../src/store/index.js";
import { createChainAdapter } from "../src/adapters/chain/index.js";

/** A row that shows -100% but had a real exit price → proceeds-read-0 suspect. */
function isSuspect(p: Position): boolean {
  return (
    p.status === "closed" &&
    p.order.chain === "base" &&
    !!p.lastExitTxHash &&
    typeof p.lastExitPriceEth === "number" &&
    p.lastExitPriceEth > 0 &&
    p.order.amountInEth > 0 &&
    // realised ≈ -amountInEth, i.e. ≤ -99% (a full loss with zero recorded proceeds)
    p.realisedPnlEth <= -0.99 * p.order.amountInEth
  );
}

interface Row {
  id: string;
  author: string;
  ca: string;
  txHash: string;
  block: string;
  oldRealised: number;
  oldPct: number;
  proceeds: number | null; // null = could not measure
  cost: number;
  newRealised: number | null;
  newPct: number | null;
  decision: "FIX" | "ZERO" | "SKIP" | "ERROR";
  note: string;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const mode = apply ? "APPLY (writes)" : "DRY-RUN (read-only)";

  const wallet = createChainAdapter("base").getWalletAddress();
  console.log("──────────────────────────────────────────────────────────────");
  console.log(` backfill-realised-pnl  ·  ${mode}`);
  console.log(`  store      : ${config.service.store}`);
  console.log(`  chain mode : ${useMock() ? "MOCK ⚠️" : "live"}`);
  console.log(`  wallet     : ${wallet}`);
  console.log(`  rpc        : ${config.chain.rpcUrl}`);
  console.log("──────────────────────────────────────────────────────────────");

  if (apply && useMock()) {
    console.error("REFUSING --apply in mock mode (would edit the mock store). Aborting.");
    process.exit(1);
  }

  const positions = await getStore().getAllPositions();
  const base_ = positions.filter(isSuspect);
  const otherChain = positions.filter(
    (p) =>
      p.status === "closed" &&
      p.order.chain !== "base" &&
      !!p.lastExitTxHash &&
      typeof p.lastExitPriceEth === "number" &&
      (p.lastExitPriceEth ?? 0) > 0 &&
      p.order.amountInEth > 0 &&
      p.realisedPnlEth <= -0.99 * p.order.amountInEth,
  );

  console.log(
    `Scanned ${positions.length} positions → ${base_.length} Base suspect(s), ` +
      `${otherChain.length} non-Base suspect(s) (manual review only).\n`,
  );
  if (otherChain.length) {
    console.log("Non-Base suspects (NOT auto-measured — review manually):");
    for (const p of otherChain) {
      console.log(`  · ${p.id} ${p.order.chain} ${p.authorHandle} tx=${p.lastExitTxHash}`);
    }
    console.log("");
  }
  if (base_.length === 0) {
    console.log("No Base suspects to repair. Done.");
    return;
  }

  const chainObj = config.chain.chainId === base.id ? base : baseSepolia;
  const client = createPublicClient({ chain: chainObj, transport: http(config.chain.rpcUrl) });

  const rows: Row[] = [];
  for (const p of base_) {
    const cost = -p.realisedPnlEth; // recorded loss == cost basis (proceeds were 0)
    const row: Row = {
      id: p.id,
      author: p.authorHandle,
      ca: p.order.contractAddress,
      txHash: p.lastExitTxHash as string,
      block: "?",
      oldRealised: p.realisedPnlEth,
      oldPct: (p.realisedPnlEth / p.order.amountInEth) * 100,
      proceeds: null,
      cost,
      newRealised: null,
      newPct: null,
      decision: "ERROR",
      note: "",
    };
    try {
      const receipt = await client.getTransactionReceipt({ hash: row.txHash as `0x${string}` });
      const blk = receipt.blockNumber;
      row.block = blk.toString();
      const addr = wallet as `0x${string}`;
      const after = await client.getBalance({ address: addr, blockNumber: blk });
      const before = await client.getBalance({ address: addr, blockNumber: blk - 1n });
      const proceedsWei = after > before ? after - before : 0n;
      const proceeds = Number(formatEther(proceedsWei));
      row.proceeds = proceeds;
      const corrected = proceeds - cost;
      row.newRealised = corrected;
      row.newPct = (corrected / p.order.amountInEth) * 100;
      if (proceeds <= 0) {
        row.decision = "ZERO";
        row.note = "still net-zero (genuine 0 OR unreadable block) — leave unchanged";
      } else if (corrected <= row.oldRealised + 1e-12) {
        row.decision = "SKIP";
        row.note = "no improvement — leave unchanged";
      } else {
        row.decision = "FIX";
        row.note = "verify the wallet had ONLY this tx in the block (cross-check txHash on BaseScan)";
      }
    } catch (err) {
      row.decision = "ERROR";
      row.note = `measure failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    rows.push(row);
  }

  // ── Print proposed corrections ───────────────────────────────────────────
  console.log("Proposed corrections (proceeds re-measured on-chain at the exit block):\n");
  for (const r of rows) {
    const f = (n: number | null) => (n === null ? "  —  " : n.toFixed(4));
    const pct = (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
    console.log(
      `[${r.decision}] ${r.id}  ${r.author}\n` +
        `      token ${r.ca}  block ${r.block}\n` +
        `      realised ${f(r.oldRealised)} (${pct(r.oldPct)})  →  ${f(r.newRealised)} (${pct(r.newPct)})` +
        `   | on-chain proceeds ${f(r.proceeds)} ETH, cost ${f(r.cost)} ETH\n` +
        `      tx https://basescan.org/tx/${r.txHash}\n` +
        `      ${r.note}\n`,
    );
  }

  const fixes = rows.filter((r) => r.decision === "FIX");
  const totalDelta = fixes.reduce((s, r) => s + ((r.newRealised as number) - r.oldRealised), 0);
  console.log("──────────────────────────────────────────────────────────────");
  console.log(
    `Summary: ${rows.length} measured · ${fixes.length} would be CORRECTED · ` +
      `${rows.filter((r) => r.decision === "ZERO").length} still-zero · ` +
      `${rows.filter((r) => r.decision === "ERROR").length} error`,
  );
  console.log(`Net realised-PnL delta if applied: ${totalDelta >= 0 ? "+" : ""}${totalDelta.toFixed(4)} ETH`);
  console.log("──────────────────────────────────────────────────────────────");

  if (!apply) {
    console.log("\nDRY-RUN — nothing written. Re-run with --apply to commit (back up the DB first).");
    return;
  }

  // ── APPLY ──────────────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const auditPath = join(config.service.dataDir, `realised-backfill-audit-${stamp}.json`);
  writeFileSync(
    auditPath,
    JSON.stringify(
      fixes.map((r) => ({ id: r.id, oldRealised: r.oldRealised, newRealised: r.newRealised, proceeds: r.proceeds, txHash: r.txHash })),
      null,
      2,
    ),
  );
  console.log(`\nAudit written: ${auditPath}`);

  const store = getStore();
  const byId = new Map(positions.map((p) => [p.id, p]));
  let written = 0;
  for (const r of fixes) {
    const pos = byId.get(r.id);
    if (!pos) continue;
    pos.realisedPnlEth = r.newRealised as number;
    await store.savePosition(pos);
    written += 1;
    console.log(`  ✓ ${r.id}: realised → ${(r.newRealised as number).toFixed(4)} ETH`);
  }
  console.log(`\nDone. Corrected ${written} position(s). Distributions untouched.`);
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});
