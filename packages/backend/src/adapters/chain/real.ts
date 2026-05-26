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
import { RealBaseData } from "../basedata/real.js";
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
  private readonly market = new RealBaseData();

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

  async sell(address: string, amountTokens: number): Promise<SwapResult> {
    this.ensureArmed();
    const price = await this.getTokenPriceEth(address);
    // NOTE: assumes the token uses 18 decimals — read decimals() for others.
    const amountIn = parseEther(amountTokens.toFixed(18));
    const route = await this.fetchKyberRoute(address, config.chain.weth, amountIn);
    const built = await this.buildKyberTx(route);
    // For ERC20 input we must approve the router once (max approval) before
    // the first swap. KyberSwap uses one MetaAggregationRouter per chain.
    await this.ensureRouterAllowance(address as Address, built.routerAddress as Address, amountIn);
    const txHash = await this.sendSwap(built, /* hasEthInput */ false);
    const amountOut = Number(formatEther(BigInt(built.amountOut)));
    log.info(`chain: sell via KyberSwap — ${describeRoute(route)} — tx ${txHash}`);
    return { txHash, amountOut, priceEth: price };
  }

  async sendEth(toAddress: string, amountEth: number): Promise<string> {
    this.ensureArmed();
    return this.walletClient.sendTransaction({
      to: toAddress as Address,
      value: parseEther(amountEth.toFixed(18)),
    });
  }

  async buybackAndBurn(amountInEth: number): Promise<{ txHash: string; tokensBurned: number }> {
    if (!config.chain.thesisToken) {
      throw new Error("THESIS_TOKEN_ADDRESS is not set — cannot run the buyback.");
    }
    // KyberSwap delivers swap output to the recipient (our wallet). Buy $THESIS
    // to our wallet, then transfer the received balance to the burn address.
    const buy = await this.buy(config.chain.thesisToken, amountInEth);
    const balance = await this.publicClient.readContract({
      address: config.chain.thesisToken as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [this.account.address],
    });
    const { request } = await this.publicClient.simulateContract({
      account: this.account,
      address: config.chain.thesisToken as Address,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [config.chain.burnAddress as Address, balance],
    });
    const burnTx = await this.walletClient.writeContract(request);
    log.info(`chain: burn ${balance.toString()} $THESIS — tx ${burnTx}`);
    return { txHash: burnTx, tokensBurned: buy.amountOut };
  }

  // --- KyberSwap Aggregator integration ----------------------------------

  /** Fetch the best route from KyberSwap's aggregator on Base. */
  private async fetchKyberRoute(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
  ): Promise<KyberRouteData> {
    const params = new URLSearchParams({
      tokenIn,
      tokenOut,
      amountIn: amountIn.toString(),
      gasInclude: "true",
      saveGas: "0",
    });
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
   *  the `value` field (KyberSwap returns it in `transactionValue`). */
  private async sendSwap(built: KyberBuildData, hasEthInput: boolean): Promise<string> {
    return this.walletClient.sendTransaction({
      to: built.routerAddress as Address,
      data: built.data as Hex,
      value: hasEthInput ? BigInt(built.transactionValue ?? built.amountIn) : undefined,
    });
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
  const fills = (route.routeSummary.route ?? []).flat();
  if (fills.length === 0) return "route unknown";
  const sources = Array.from(new Set(fills.map((f) => f.exchange ?? f.poolType ?? "?")));
  return `route ${sources.join(" + ")}`;
}
