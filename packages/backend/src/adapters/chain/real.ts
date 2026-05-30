import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  maxUint256,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { config } from "../../config.js";
import { log } from "../../util/log.js";
import { createBaseDataAdapter } from "../basedata/index.js";
import type { ChainAdapter, SwapResult } from "./index.js";

/** KyberSwap Aggregator API on Base — free public endpoint, no API key required. */
const KYBER_API = "https://aggregator-api.kyberswap.com/base/api/v1";
/** Optional but recommended — lets KyberSwap attribute volume to our app. */
const KYBER_CLIENT_ID = "thesisonbase";
/** KyberSwap sentinel for the chain's native asset (ETH on Base). */
const ETH_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
/** Fallback slippage tolerance, in basis points (1% = 100 bps). */
const SLIPPAGE_BPS_FALLBACK = 800;
/** Quote-to-build deadline, in seconds. */
const QUOTE_DEADLINE_SEC = 20 * 60;

/** Minimal ERC20 ABI — approvals for the KyberSwap router, transfers for
 *  buyback-and-burn, allowance reads to avoid redundant approvals. */
const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/**
 * Real Base-chain client (viem) with swaps routed through the KyberSwap
 * Aggregator API.
 *
 * KyberSwap aggregates Uniswap v2/v3/v4, Aerodrome, BaseSwap and the rest of
 * the Base DEX universe. Their public endpoint is free and requires no API key
 * (we only send an `x-client-id` header so they can attribute volume to us).
 *
 * Flow:
 *   1. GET /routes        → route summary + best price
 *   2. POST /route/build  → calldata + router address (+ value for ETH input)
 *   3. (sell only) approve the router for the input token
 *   4. sendTransaction with the returned calldata
 *
 * We stay non-custodial throughout: KyberSwap returns calldata, we sign with
 * our own private key, the wallet keeps the funds. Balance and price reads
 * work immediately. Spending — buy, sell, sendEth, buybackAndBurn — is GATED
 * behind LIVE_TRADING_ARMED.
 */
export class RealChain implements ChainAdapter {
  private readonly publicClient;
  private readonly walletClient;
  private readonly account;
  // Use the factory so the chain adapter inherits whichever data provider is
  // configured (Birdeye when BIRDEYE_API_KEY is set, DexScreener otherwise).
  // Hardcoding `new RealBaseData()` here was the silent bug that kept the
  // monitor's price checks pinned to DexScreener even after Birdeye was on.
  private readonly market = createBaseDataAdapter();

  constructor() {
    if (!config.chain.tradingWalletKey) {
      throw new Error("TRADING_WALLET_PRIVATE_KEY is required for the live chain adapter.");
    }
    const chain = config.chain.chainId === base.id ? base : baseSepolia;
    this.account = privateKeyToAccount(config.chain.tradingWalletKey as `0x${string}`);
    this.publicClient = createPublicClient({ chain, transport: http(config.chain.rpcUrl) });
    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(config.chain.rpcUrl),
    });
  }

  getWalletAddress(): string {
    return this.account.address;
  }

  async getWalletBalanceEth(): Promise<number> {
    const wei = await this.publicClient.getBalance({ address: this.account.address });
    return Number(formatEther(wei));
  }

  async getTokenPriceEth(address: string): Promise<number> {
    return this.market.getPriceEth(address);
  }

  async buy(address: string, amountInEth: number): Promise<SwapResult> {
    this.ensureArmed();
    const price = await this.getTokenPriceEth(address);
    const amountIn = parseEther(amountInEth.toFixed(18));
    // Native ETH input — no approval needed, the router is paid via tx.value.
    const route = await this.fetchKyberRoute(ETH_SENTINEL, address, amountIn);
    const built = await this.buildKyberTx(route);
    const txHash = await this.sendSwap(built, /* hasEthInput */ true);
    const amountOut = Number(formatEther(BigInt(built.amountOut)));
    log.info(`chain: buy via KyberSwap — ${describeRoute(route)} — tx ${txHash}`);
    return { txHash, amountOut, priceEth: price };
  }

  async sell(
    address: string,
    amountTokens: number,
    opts?: { maxAttempts?: number; delayBetweenMs?: number },
  ): Promise<SwapResult> {
    this.ensureArmed();
    const maxAttempts = Math.max(1, opts?.maxAttempts ?? 1);
    const delayBetweenMs = Math.max(0, opts?.delayBetweenMs ?? 0);
    // Each retry tightens the live-balance clamp to absorb larger transfer
    // taxes. The default first attempt stays at 99.5% (back-compat with the
    // single-attempt callers — TP / SL); retries widen the safety margin
    // toward 7-8% which covers any reasonable Clanker transfer tax.
    const clampSteps = [995n, 970n, 950n, 920n];
    const excludedSources = new Set<string>();
    let lastErr: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0 && delayBetweenMs > 0) {
        log.info(
          `chain: sell retry ${attempt + 1}/${maxAttempts} for ${address} — ` +
            `waiting ${delayBetweenMs}ms before next try ` +
            `(clamp ${clampSteps[Math.min(attempt, clampSteps.length - 1)]}/1000, ` +
            `excluding ${excludedSources.size > 0 ? [...excludedSources].join("+") : "none"})`,
        );
        await new Promise((r) => setTimeout(r, delayBetweenMs));
      }

      const clampBps = clampSteps[Math.min(attempt, clampSteps.length - 1)];
      const price = await this.getTokenPriceEth(address);
      // NOTE: assumes the token uses 18 decimals — read decimals() for others.
      const requestedAmount = parseEther(amountTokens.toFixed(18));
      // The Monitor sizes sells off the cost basis (amountInEth / entryPrice),
      // but slippage on the original buy and transfer-tax tokens both leave the
      // on-chain balance slightly below that figure. Trying to sell more than
      // we hold reverts the router with `TransferHelper: TRANSFER_FROM_FAILED`,
      // so we read the live balance and clamp the input. The clamp tightens on
      // each retry (see clampSteps above) so transient revert → next try.
      const actualBalance = (await this.publicClient.readContract({
        address: address as Address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [this.account.address],
      })) as bigint;
      const safeBalance = (actualBalance * clampBps) / 1000n;
      const amountIn = requestedAmount < safeBalance ? requestedAmount : safeBalance;
      if (amountIn === 0n) {
        throw new Error(`chain: cannot sell — wallet holds 0 of ${address}`);
      }
      if (amountIn < requestedAmount) {
        log.warn(
          `chain: sell amount clamped — requested ${requestedAmount.toString()} but wallet ` +
            `holds ${actualBalance.toString()} (selling ${clampBps.toString()}/1000: ${amountIn.toString()})`,
        );
      }

      // Build a route, excluding any DEXes that reverted on a previous
      // attempt. If KyberSwap can't find an alternative route (e.g. all the
      // token's liquidity sits on the excluded pool) it throws — we propagate
      // immediately because no future retry will help.
      //
      // tokenOut = ETH_SENTINEL (not config.chain.weth) tells KyberSwap to
      // deliver NATIVE ETH to the wallet. The router routes through the same
      // WETH pools as before and auto-unwraps right before the final transfer,
      // saving us a follow-up WETH.withdraw() call after every close. Without
      // this the trading wallet kept accumulating WETH that the operator had
      // to manually unwrap before the funds were usable for the next buy.
      let route: KyberRouteData;
      try {
        route = await this.fetchKyberRoute(
          address,
          ETH_SENTINEL,
          amountIn,
          [...excludedSources],
        );
      } catch (err) {
        log.warn(
          `chain: sell route fetch failed on attempt ${attempt + 1}/${maxAttempts} ` +
            `(excluded: ${excludedSources.size > 0 ? [...excludedSources].join("+") : "none"}): ${String(err)}`,
        );
        throw err;
      }
      const routeSources = extractRouteSources(route);

      try {
        const built = await this.buildKyberTx(route);
        // For ERC20 input we must approve the router once (max approval) before
        // the first swap. KyberSwap uses one MetaAggregationRouter per chain.
        await this.ensureRouterAllowance(
          address as Address,
          built.routerAddress as Address,
          amountIn,
        );
        const txHash = await this.sendSwap(built, /* hasEthInput */ false);
        const amountOut = Number(formatEther(BigInt(built.amountOut)));
        log.info(
          `chain: sell via KyberSwap — ${describeRoute(route)} — tx ${txHash}` +
            (attempt > 0 ? ` (on retry ${attempt + 1}/${maxAttempts})` : ""),
        );
        return { txHash, amountOut, priceEth: price };
      } catch (err) {
        lastErr = err;
        const msg = String(err);
        // Only retry the known-transient revert. Anything else (e.g. router
        // OOG, RPC failure, no-liquidity, allowance race) is unlikely to
        // resolve by waiting + tightening, so fail fast.
        const isTransferFail = msg.includes("TRANSFER_FROM_FAILED");
        if (!isTransferFail || attempt + 1 >= maxAttempts) throw err;
        // Add this attempt's DEX sources to the exclusion set so the next
        // route fetch is forced through different pools. Combined with the
        // tighter clamp on the next attempt, this defeats both the
        // transfer-tax-too-high and the bad-pool-hook failure modes.
        for (const src of routeSources) excludedSources.add(src);
        log.warn(
          `chain: sell attempt ${attempt + 1}/${maxAttempts} reverted with ` +
            `TRANSFER_FROM_FAILED — next try will tighten clamp + exclude ${routeSources.join("+") || "(unknown)"}`,
        );
      }
    }
    throw lastErr;
  }

  async sendEth(toAddress: string, amountEth: number): Promise<string> {
    this.ensureArmed();
    const hash = await this.walletClient.sendTransaction({
      to: toAddress as Address,
      value: parseEther(amountEth.toFixed(18)),
    });
    await this.confirmOrThrow(hash, `sendEth to ${toAddress}`);
    return hash;
  }

  async buybackAndBurn(amountInEth: number): Promise<{ txHash: string; tokensBurned: number }> {
    if (!config.chain.thesisToken) {
      throw new Error("THESIS_TOKEN_ADDRESS is not set — cannot run the buyback.");
    }
    // KyberSwap delivers swap output to the recipient (our wallet). We must
    // burn ONLY the freshly-bought tokens — not the entire $THESIS balance —
    // otherwise we'd torch any $THESIS the bot is currently holding as a
    // funded position (e.g. when an author pitched $THESIS itself). Approach:
    // snapshot the balance BEFORE the buy, snapshot AFTER, and the delta is
    // exactly what we just bought and should burn.
    const thesisAddress = config.chain.thesisToken as Address;
    const balanceBefore = (await this.publicClient.readContract({
      address: thesisAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [this.account.address],
    })) as bigint;

    // Some Clanker v4 hooks revert the buy if we just sold the same token in
    // the previous block (anti-MEV / anti-snipe protection). Retry once after
    // a short delay so the hook's cooldown elapses.
    let buy;
    try {
      buy = await this.buy(config.chain.thesisToken, amountInEth);
    } catch (err) {
      log.warn(
        `chain: buyback first attempt reverted — retrying in 30s (${String(err).slice(0, 120)})`,
      );
      await new Promise((r) => setTimeout(r, 30_000));
      buy = await this.buy(config.chain.thesisToken, amountInEth);
    }
    // Wait for the buy tx to be MINED before reading balanceOf again — we
    // need post-buy state to compute the delta.
    //
    // Use 2 confirmations (not the viem default of 1): Alchemy's read endpoint
    // serves balanceOf from a pool of replicas, and a single-confirmation tx
    // can be "official" on one replica while the next balanceOf hits a sibling
    // that is one block behind. Two confirmations gives the cluster time to
    // converge before we read.
    await this.publicClient.waitForTransactionReceipt({
      hash: buy.txHash as Hex,
      confirmations: 2,
    });

    // Read balance with retries. Even with confirmations: 2 we see
    // intermittent stale reads — especially when KyberSwap routes via
    // uniswap-v4-doppler (Bankr) hooks, whose settlement performs extra
    // internal calls that can leave individual RPC replicas momentarily
    // out of sync. We retry up to 5 times with 2s spacing; in practice
    // the second read almost always succeeds. Total worst-case extra
    // wait ~10s — well worth it vs silently losing the burn (incident
    // 2026-05-29/30: 8+ burns dropped because the first balance read
    // came back stale and we threw "balance didn't grow" prematurely).
    let balanceAfter = balanceBefore;
    for (let attempt = 0; attempt < 5; attempt++) {
      balanceAfter = (await this.publicClient.readContract({
        address: thesisAddress,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [this.account.address],
      })) as bigint;
      if (balanceAfter > balanceBefore) break;
      if (attempt < 4) await new Promise((r) => setTimeout(r, 2_000));
    }

    const bought = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0n;
    if (bought === 0n) {
      throw new Error(
        `chain: buyback tx ${buy.txHash} confirmed but $THESIS balance didn't grow after 5 retries — cannot burn`,
      );
    }
    // Defensive clamp: never burn more than the current wallet balance.
    const toBurn = bought > balanceAfter ? balanceAfter : bought;

    const { request } = await this.publicClient.simulateContract({
      account: this.account,
      address: thesisAddress,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [config.chain.burnAddress as Address, toBurn],
    });
    const burnTx = await this.walletClient.writeContract(request);
    await this.confirmOrThrow(burnTx, "burn $THESIS");
    log.info(
      `chain: burn ${toBurn.toString()} $THESIS (bought this round; wallet still holds ${(balanceAfter - toBurn).toString()}) — tx ${burnTx}`,
    );
    return { txHash: burnTx, tokensBurned: buy.amountOut };
  }

  // --- KyberSwap Aggregator integration ----------------------------------

  /** Fetch the best route from KyberSwap's aggregator on Base.
   *
   *  `excludedSources` (optional) is a list of DEX identifiers KyberSwap
   *  should skip when picking pools — used by the sell-retry loop to avoid
   *  pools that just reverted with TRANSFER_FROM_FAILED. KyberSwap expects
   *  the comma-separated form (e.g. "uniswapv4,pumpswap"). */
  private async fetchKyberRoute(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    excludedSources?: string[],
  ): Promise<KyberRouteData> {
    const params = new URLSearchParams({
      tokenIn,
      tokenOut,
      amountIn: amountIn.toString(),
      gasInclude: "true",
      saveGas: "0",
    });
    if (excludedSources && excludedSources.length > 0) {
      params.set("excludedSources", excludedSources.join(","));
    }
    const res = await fetch(`${KYBER_API}/routes?${params}`, {
      headers: { "x-client-id": KYBER_CLIENT_ID },
    });
    if (!res.ok) {
      throw new Error(`KyberSwap /routes ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as KyberApiResponse<KyberRouteData>;
    if (json.code !== 0 || !json.data?.routeSummary) {
      throw new Error(
        `KyberSwap: no liquidity for ${tokenIn} -> ${tokenOut} (code ${json.code}: ${json.message ?? "unknown"}).`,
      );
    }
    return json.data;
  }

  /** Turn the route summary into ready-to-send calldata. */
  private async buildKyberTx(route: KyberRouteData): Promise<KyberBuildData> {
    const slippageBps =
      Math.max(1, Math.round(config.chain.slippagePct * 100)) || SLIPPAGE_BPS_FALLBACK;
    const body = {
      routeSummary: route.routeSummary,
      sender: this.account.address,
      recipient: this.account.address,
      slippageTolerance: slippageBps,
      deadline: Math.floor(Date.now() / 1000) + QUOTE_DEADLINE_SEC,
      source: KYBER_CLIENT_ID,
    };
    const res = await fetch(`${KYBER_API}/route/build`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-client-id": KYBER_CLIENT_ID,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`KyberSwap /route/build ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as KyberApiResponse<KyberBuildData>;
    if (json.code !== 0 || !json.data?.data) {
      throw new Error(
        `KyberSwap: build failed (code ${json.code}: ${json.message ?? "unknown"}).`,
      );
    }
    return json.data;
  }

  /** Make sure `spender` (the KyberSwap router) is approved to spend at least
   *  `amount` of `token` from our wallet. Uses a one-time max approval. */
  private async ensureRouterAllowance(
    token: Address,
    spender: Address,
    amount: bigint,
  ): Promise<void> {
    const current = await this.publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [this.account.address, spender],
    });
    if (current >= amount) return;
    const { request } = await this.publicClient.simulateContract({
      account: this.account,
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, maxUint256],
    });
    const txHash = await this.walletClient.writeContract(request);
    log.info(`chain: approved KyberSwap router ${spender} to spend ${token} — tx ${txHash}`);
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
  }

  /** Submit the swap transaction. For ETH-input swaps the router is paid via
   *  the `value` field (KyberSwap returns it in `transactionValue`). Waits
   *  for the receipt and throws on an on-chain revert so callers don't treat
   *  a reverted swap as a successful sale. */
  private async sendSwap(built: KyberBuildData, hasEthInput: boolean): Promise<string> {
    const hash = await this.walletClient.sendTransaction({
      to: built.routerAddress as Address,
      data: built.data as Hex,
      value: hasEthInput ? BigInt(built.transactionValue ?? built.amountIn) : undefined,
    });
    await this.confirmOrThrow(hash, `swap via ${built.routerAddress}`);
    return hash;
  }

  /** Wait for a tx to be mined; throw if its receipt reports a revert.
   *  walletClient.sendTransaction only returns when the tx is BROADCAST, so
   *  without this check a reverted swap looks identical to a successful one. */
  private async confirmOrThrow(hash: Hex | string, label: string): Promise<void> {
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: hash as Hex });
    if (receipt.status !== "success") {
      throw new Error(
        `chain: ${label} reverted on-chain — tx ${hash} (block ${receipt.blockNumber})`,
      );
    }
  }

  private ensureArmed(): void {
    if (!config.chain.liveTradingArmed) {
      throw new Error(
        "Live trading is not armed. Validate on Base Sepolia first, then set " +
          "LIVE_TRADING_ARMED=true to enable real on-chain transactions.",
      );
    }
  }
}

interface KyberApiResponse<T> {
  code: number;
  message?: string;
  data?: T;
}

interface KyberFill {
  pool?: string;
  tokenIn?: string;
  tokenOut?: string;
  swapAmount?: string;
  amountOut?: string;
  exchange?: string;
  poolType?: string;
}

interface KyberRouteSummary {
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

interface KyberRouteData {
  routeSummary: KyberRouteSummary;
  routerAddress: string;
}

interface KyberBuildData {
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

/** Human-readable summary of the DEXes KyberSwap routed through, for logging. */
function describeRoute(route: KyberRouteData): string {
  const sources = extractRouteSources(route);
  if (sources.length === 0) return "route unknown";
  return `route ${sources.join(" + ")}`;
}

/** Distinct DEX/pool source identifiers (e.g. "uniswapv4", "pumpswap") used
 *  by the route. Returned in the form KyberSwap accepts for `excludedSources`,
 *  so the sell-retry loop can blacklist a failing source on the next attempt. */
function extractRouteSources(route: KyberRouteData): string[] {
  const fills = (route.routeSummary.route ?? []).flat();
  return Array.from(
    new Set(
      fills
        .map((f) => (f.exchange ?? f.poolType ?? "").trim())
        .filter((s) => s.length > 0),
    ),
  );
}
