/**
 * Gap-2 — a LIVE Solana win with SOLANA_BUYBACK_WALLET UNSET must NOT silently
 * burn the buyback-substitute slice.
 *
 * The endowment.ts buyback leg only reaches the "unset wallet" branch when
 * `useMock()` is false (in mock mode the `useMock() || config.solana.buybackWallet`
 * guard short-circuits true and the send fires against the mock chain). So this
 * file forces THESIS_MODE=live BEFORE config.ts evaluates, and leaves
 * SOLANA_BUYBACK_WALLET unset, to exercise the deferred-for-retry branch.
 *
 * A RecordingChain is injected via __setChainForTest so createChainAdapter never
 * builds the RealSolanaChain (no network) — the override wins regardless of mode.
 *
 * Characterization: pins that on the unset-wallet branch (a) the slice is NOT
 * sent, (b) buybackDone stays false (deferred, not marked paid), and (c) a warn
 * is logged so the operator can see the slice is waiting.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Set BEFORE config.ts is evaluated (src modules are dynamically imported below).
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "thesis-test-"));
process.env.THESIS_MODE = "live";
delete process.env.SOLANA_BUYBACK_WALLET;

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "@thesis/shared";

const { runEndowment } = await import("../src/agents/endowment.js");
const { __setChainForTest } = await import("../src/adapters/chain/index.js");
const { useMock, config } = await import("../src/config.js");
type ChainAdapter = import("../src/adapters/chain/index.js").ChainAdapter;
type SwapResult = import("../src/adapters/chain/index.js").SwapResult;

class RecordingChain implements ChainAdapter {
  readonly sends: { to: string; amountEth: number }[] = [];
  readonly buybacks: number[] = [];
  getWalletAddress(): string {
    return "So1anaWa11et1111111111111111111111111111111";
  }
  async getWalletBalanceEth(): Promise<number> {
    return 1.5;
  }
  async buy(_a: string, amountInEth: number): Promise<SwapResult> {
    return { txHash: "mockbuy", amountOut: amountInEth, priceEth: 1 };
  }
  async sell(): Promise<SwapResult> {
    return { txHash: "mocksell", amountOut: 0, priceEth: 1 };
  }
  async getTokenPriceEth(): Promise<number> {
    return 1;
  }
  async quoteSell(): Promise<{ proceedsEth: number }> {
    return { proceedsEth: 0 };
  }
  async sendEth(to: string, amountEth: number): Promise<string> {
    this.sends.push({ to, amountEth });
    return "mocksendsig";
  }
  async buybackAndBurn(amountInEth: number): Promise<{ txHash: string; tokensBurned: number }> {
    this.buybacks.push(amountInEth);
    return { txHash: "mockburn", tokensBurned: 1 };
  }
}

function solPosition(id = "pos-sol-unset"): Position {
  return {
    id,
    postId: `${id}-post`,
    authorXId: "778",
    authorHandle: "@sol_author",
    order: {
      contractAddress: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfpump",
      chain: "solana",
      amountInEth: 1,
      takeProfits: [{ priceX: 2, sellFraction: 0.5 }],
      stopLossX: 0.7,
    },
    status: "closed",
    entryPriceEth: 0.0000004,
    entryTxHash: "mocksig",
    remainingFraction: 0,
    tiersHit: 1,
    realisedPnlEth: 1,
    openedAt: new Date().toISOString(),
    closedAt: new Date().toISOString(),
    lastExitTxHash: "mockexitsig",
  };
}

test("Endowment: live Solana win with SOLANA_BUYBACK_WALLET unset defers the slice and warns (does not silently drop)", async () => {
  assert.equal(useMock(), false, "this branch is only reachable in live mode");
  assert.equal(config.solana.buybackWallet, "", "the wallet must be unset to hit the deferred branch");

  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]): void => {
    warnings.push(args.map(String).join(" "));
  };

  const chain = new RecordingChain();
  __setChainForTest(chain);
  const pos = solPosition();
  try {
    const result = await runEndowment(pos, 1, { silentAuthorTweet: true });
    assert.ok(result, "a profitable settlement must still return a distribution");
    // (a) the slice was NOT sent and NOT burned — money stayed put.
    assert.equal(chain.sends.length, 0, "no SOL send when the buyback wallet is unset");
    assert.deepEqual(chain.buybacks, [], "Solana never burns $THESIS");
    // (b) buybackDone stays false → the monitor's resume pass retries it once the
    //     wallet is configured, rather than marking the slice paid.
    assert.equal(pos.settlement?.buybackDone, false, "buyback leg must remain unpaid for retry");
    // (c) a warn names the unset wallet so the deferral is visible, not silent.
    assert.ok(
      warnings.some((w) => w.includes("SOLANA_BUYBACK_WALLET unset")),
      "a warning must be logged so the unpaid slice is visible",
    );
  } finally {
    __setChainForTest(null);
    console.warn = realWarn;
  }
});
