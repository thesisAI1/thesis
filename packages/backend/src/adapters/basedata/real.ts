import type { Chain, Holder } from "@thesis/shared";
import { config } from "../../config.js";
import { log } from "../../util/log.js";
import { detectVirtualsLaunchpad } from "./base-launchpad.js";
import { toEthPrice } from "./price-units.js";
import type { BaseDataAdapter, PriceSnapshotEth, TokenOnChain } from "./index.js";

const DEXSCREENER = "https://api.dexscreener.com/latest/dex/tokens";
const GOPLUS = "https://api.gopluslabs.io/api/v1/token_security";
const BANKR_LAUNCHES = "https://api.bankr.bot/token-launches";
const ETHERSCAN_V2 = "https://api.etherscan.io/v2/api";

/**
 * Clanker token-factory contracts on Base (v0-v4). A token whose on-chain
 * deployer is one of these was launched via Clanker.
 */
const CLANKER_FACTORIES = new Set([
  "0xe85a59c628f7d27878aceb4bf3b35733630083a9", // v4
  "0x2a787b2362021cc3eea3c24c4748a6cd5b687382", // v3.1
  "0x375c15db32d28cecdcab5c03ab889bf15cbd2c5e", // v3.0
  "0x732560fa1d1a76350b1a500155ba978031b53833", // v2
  "0x9b84fce5dcd9a38d2d01d5d72373f6b6b067c3e1", // v1
  "0x250c9fb2b411b48273f69879007803790a6aea47", // v0 (SocialDexDeployer)
]);

/**
 * Real Base-chain data — DexScreener (price, liquidity, chain) + GoPlus
 * (holders, honeypot). Both are free public APIs; no key required.
 */
export class RealBaseData implements BaseDataAdapter {
  async getToken(address: string): Promise<TokenOnChain> {
    const [market, security, detected] = await Promise.all([
      this.fetchMarket(address),
      this.fetchSecurity(address),
      this.detectLaunchpad(address),
    ]);
    // Mark holders that aren't real circulating supply (LP pools, burns, locks)
    // so the Auditor can exclude them from its top-10 concentration gate.
    const topHolders = labelHolders(security.topHolders, new Set(market.pairAddresses));
    // Bankr/Clanker win first (explicit API / deployer proof); a graduated
    // Virtuals token isn't either, so it falls through to the VIRTUAL-paired
    // signal derived from the pools we already fetched. No extra network call.
    const launchpad = detected ?? market.launchpadFromPairs;
    return {
      contractAddress: address,
      chain: market.chain,
      priceEth: market.priceEth,
      liquidityUsd: market.liquidityUsd,
      marketCapUsd: market.marketCapUsd,
      launchedAt: market.launchedAt,
      launchpad,
      isHoneypot: security.isHoneypot,
      topHolders,
    };
  }

  async getPriceEth(address: string): Promise<number> {
    return (await this.fetchMarket(address)).priceEth;
  }

  /** VIRTUAL price in ETH — its deepest WETH-quoted Base pool's `priceNative`.
   *  Cached ~60s so a monitor tick that prices many Virtuals tokens makes one
   *  fetch. Returns null on failure or when VIRTUAL isn't configured; callers
   *  then treat a VIRTUAL-quoted price as "no price" rather than mislabel it. */
  private virtualRateCache: { rate: number | null; at: number } | null = null;
  private static readonly VIRTUAL_RATE_TTL_MS = 60_000;
  private async getVirtualEthRate(): Promise<number | null> {
    const virtual = config.chain.virtualToken;
    if (!virtual) return null;
    const now = Date.now();
    const cache = this.virtualRateCache;
    if (cache && now - cache.at < RealBaseData.VIRTUAL_RATE_TTL_MS) return cache.rate;
    let rate: number | null = null;
    try {
      const res = await fetch(`${DEXSCREENER}/${virtual}`);
      if (res.ok) {
        const json = (await res.json()) as { pairs?: DexPair[] };
        const weth = config.chain.weth.toLowerCase();
        const pool = (json.pairs ?? [])
          .filter((p) => p.chainId === "base" && p.quoteToken?.address?.toLowerCase() === weth)
          .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
        const px = Number(pool?.priceNative ?? 0);
        if (px > 0) rate = px;
      }
    } catch (err) {
      // A VIRTUAL-hop outage no-prices the WHOLE Virtuals cohort this tick (they
      // read as no-price, not ETH — safe, but invisible). Surface it so a
      // sustained outage doesn't look like "no Virtuals positions moving".
      log.warn(`basedata: VIRTUAL/ETH rate fetch failed — Virtuals tokens unpriced this tick: ${String(err)}`);
    }
    this.virtualRateCache = { rate, at: now };
    return rate;
  }

  async getPricesEth(addresses: string[]): Promise<Map<string, number>> {
    const snapshots = await this.getSnapshotsEth(addresses);
    const out = new Map<string, number>();
    for (const [addr, snap] of snapshots) out.set(addr, snap.priceEth);
    return out;
  }

  async getSnapshotsEth(addresses: string[]): Promise<Map<string, PriceSnapshotEth>> {
    const out = new Map<string, PriceSnapshotEth>();
    let pending = Array.from(new Set(addresses.map((a) => a.toLowerCase())));
    if (pending.length === 0) return out;
    // DexScreener's /tokens endpoint caps each RESPONSE at 30 PAIRS total, NOT
    // 30 tokens. Many Clanker/Bankr tokens have a WETH pool AND a USDC pool, so
    // a 30-address batch can come back as 30 pairs covering only ~20 tokens -
    // the rest are silently ABSENT from the response, read downstream as "no
    // price", and so never get TP/SL evaluated (the monitor skips them) while
    // the dashboard freezes them at entry price. So re-query whatever a round
    // failed to cover, shrinking the chunk size each pass down to single-address
    // calls, which a 30-pair cap can never truncate below one token's own pools.
    for (const chunkSize of [30, 8, 2, 1]) {
      if (pending.length === 0) break;
      pending = await this.fetchSnapshotChunks(pending, chunkSize, out);
    }
    return out;
  }

  /** Snapshot `addresses` in chunks of `chunkSize`, writing each resolved
   *  address (lowercased) → {priceEth, marketCapUsd, symbol, logoUrl} into
   *  `out`. Returns the addresses NOT resolved this pass (absent from the
   *  capped response, or unpriced) so the caller can re-query them at a
   *  smaller chunk size. */
  private async fetchSnapshotChunks(
    addresses: string[],
    chunkSize: number,
    out: Map<string, PriceSnapshotEth>,
  ): Promise<string[]> {
    const chunks: string[][] = [];
    for (let i = 0; i < addresses.length; i += chunkSize) {
      chunks.push(addresses.slice(i, i + chunkSize));
    }
    const stillMissing = new Set(addresses);
    await Promise.all(
      chunks.map(async (chunk) => {
        try {
          const res = await fetch(`${DEXSCREENER}/${chunk.join(",")}`);
          if (!res.ok) return;
          const json = (await res.json()) as { pairs?: DexPair[] };
          const byToken = new Map<string, DexPair[]>();
          for (const p of json.pairs ?? []) {
            const addr = p.baseToken?.address?.toLowerCase();
            if (!addr) continue;
            const list = byToken.get(addr) ?? [];
            list.push(p);
            byToken.set(addr, list);
          }
          const virtual = config.chain.virtualToken;
          for (const [addr, pairs] of byToken) {
            const base = pairs.filter((p) => p.chainId === "base");
            const pool = (base.length ? base : pairs).sort(
              (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
            )[0];
            if (!pool) continue;
            const native = Number(pool.priceNative ?? 0);
            if (!(native > 0)) continue;
            // Convert VIRTUAL-quoted prices to ETH (cached rate → ≤1 fetch/tick);
            // WETH-quoted prices pass straight through.
            const isVirtualQuoted =
              !!virtual && pool.quoteToken?.address?.toLowerCase() === virtual.toLowerCase();
            const virtualEthRate = isVirtualQuoted ? await this.getVirtualEthRate() : null;
            const price = toEthPrice(native, pool.quoteToken?.address, { virtual, virtualEthRate });
            if (price > 0) {
              // Symbol + logo ride along from the SAME response — token-level
              // info is identical across a token's pairs, so take the ticker
              // off the priced pool and the first imageUrl found in any pair.
              const symbol = pool.baseToken?.symbol ?? "";
              let logoUrl: string | null = null;
              for (const pr of pairs) {
                if (pr.info?.imageUrl) {
                  logoUrl = pr.info.imageUrl;
                  break;
                }
              }
              out.set(addr, {
                priceEth: price,
                marketCapUsd: pool.marketCap ?? pool.fdv ?? 0,
                symbol,
                logoUrl,
              });
              stillMissing.delete(addr);
            }
          }
        } catch {
          /* one chunk failing shouldn't poison the whole batch */
        }
      }),
    );
    return [...stillMissing];
  }

  async getTokenSymbol(address: string): Promise<string> {
    try {
      const res = await fetch(`${DEXSCREENER}/${address}`);
      if (!res.ok) return "";
      const json = (await res.json()) as { pairs?: DexPair[] };
      const pool = (json.pairs ?? []).find(
        (p) =>
          p.baseToken?.address?.toLowerCase() === address.toLowerCase() &&
          p.baseToken?.symbol,
      );
      return pool?.baseToken?.symbol ?? "";
    } catch {
      return "";
    }
  }

  private async fetchMarket(address: string): Promise<{
    chain: Chain;
    priceEth: number;
    liquidityUsd: number;
    marketCapUsd: number;
    launchedAt: string;
    /** Every LP pool contract address for this token — used to exclude pools
     *  from the Auditor's top-10 holder concentration calc. */
    pairAddresses: string[];
    /** "virtuals" when any Base pool is quoted in $VIRTUAL (a graduated
     *  Virtuals agent token), else null. Layered under Bankr/Clanker detection. */
    launchpadFromPairs: "virtuals" | null;
  }> {
    const res = await fetch(`${DEXSCREENER}/${address}`);
    if (!res.ok) throw new Error(`DexScreener ${res.status}`);
    const json = (await res.json()) as { pairs?: DexPair[] };
    const pairs = json.pairs ?? [];
    // Prefer Base pairs, then the pool with the deepest liquidity.
    const base = pairs.filter((p) => p.chainId === "base");
    const considered = base.length ? base : pairs;
    const pool = [...considered].sort(
      (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
    )[0];
    if (!pool) throw new Error(`No DEX pairs found for ${address}`);
    // All Base pair addresses for this token — typically one or two pools.
    const pairAddresses = considered
      .map((p) => p.pairAddress)
      .filter((p): p is string => typeof p === "string" && p.length > 0)
      .map((p) => p.toLowerCase());
    // priceNative is in the pool's QUOTE token. WETH-quoted (Clanker/Bankr) is
    // already ETH; a VIRTUAL-quoted (graduated Virtuals) pool needs × VIRTUAL/ETH.
    // Only fetch the rate when the chosen pool is VIRTUAL-quoted — Clanker/Bankr
    // pay zero extra calls.
    const virtual = config.chain.virtualToken;
    const isVirtualQuoted =
      !!virtual && pool.quoteToken?.address?.toLowerCase() === virtual.toLowerCase();
    const virtualEthRate = isVirtualQuoted ? await this.getVirtualEthRate() : null;
    return {
      chain: toChain(pool.chainId),
      priceEth: toEthPrice(Number(pool.priceNative ?? 0), pool.quoteToken?.address, {
        virtual,
        virtualEthRate,
      }),
      liquidityUsd: pool.liquidity?.usd ?? 0,
      marketCapUsd: pool.marketCap ?? pool.fdv ?? 0,
      launchedAt: pool.pairCreatedAt
        ? new Date(pool.pairCreatedAt).toISOString()
        : new Date().toISOString(),
      pairAddresses,
      launchpadFromPairs: detectVirtualsLaunchpad(considered, config.chain.virtualToken),
    };
  }

  private async fetchSecurity(address: string): Promise<{
    isHoneypot: boolean;
    topHolders: Holder[];
  }> {
    // GoPlus chain id 8453 = Base mainnet.
    const url = `${GOPLUS}/8453?contract_addresses=${address.toLowerCase()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GoPlus ${res.status}`);
    const json = (await res.json()) as { result?: Record<string, GoPlusToken> };
    const token = json.result?.[address.toLowerCase()];
    if (!token) return { isHoneypot: false, topHolders: [] };
    const topHolders: Holder[] = (token.holders ?? []).slice(0, 20).map((h) => ({
      address: h.address,
      share: Number(h.percent ?? 0),
      label: preliminaryLabel(h),
    }));
    return {
      isHoneypot: token.is_honeypot === "1" || token.cannot_sell_all === "1",
      topHolders,
    };
  }

  /** Identify whether a token was launched via Bankr or Clanker (else null). */
  private async detectLaunchpad(address: string): Promise<string | null> {
    // Bankr — public, unauthenticated. A token-launch fee record exists only
    // for tokens that Bankr deployed.
    try {
      const res = await fetch(`${BANKR_LAUNCHES}/${address}/fees`);
      if (res.ok) {
        const json = (await res.json()) as { error?: unknown };
        if (json && json.error === undefined) return "bankr";
      }
    } catch {
      /* ignore — fall through to the Clanker check */
    }
    // Clanker — the token's on-chain deployer is one of the Clanker factories.
    try {
      const deployer = await this.deployerOf(address);
      if (deployer && CLANKER_FACTORIES.has(deployer.toLowerCase())) return "clanker";
    } catch {
      /* ignore */
    }
    return null;
  }

  /** The address that created a contract, via the explorer API. */
  private async deployerOf(address: string): Promise<string | null> {
    if (!config.auditor.basescanApiKey) return null;
    const url =
      `${ETHERSCAN_V2}?chainid=8453&module=contract&action=getcontractcreation` +
      `&contractaddresses=${address}&apikey=${config.auditor.basescanApiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      result?: Array<{ contractCreator?: string }>;
    };
    return json.result?.[0]?.contractCreator ?? null;
  }
}

interface DexPair {
  chainId: string;
  /** The LP pool contract address. */
  pairAddress?: string;
  /** The token being priced (vs WETH/USDC etc) — has the ticker we want. */
  baseToken?: { address?: string; symbol?: string; name?: string };
  /** The pool's quote asset (WETH for Clanker/Bankr, $VIRTUAL for graduated
   *  Virtuals tokens). Drives launchpad detection + price-unit conversion. */
  quoteToken?: { address?: string; symbol?: string; name?: string };
  priceNative?: string;
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  /** Token-level "info" block — carries the creator-uploaded logo. */
  info?: { imageUrl?: string };
  /** Unix ms timestamp the trading pair was created. */
  pairCreatedAt?: number;
}

interface GoPlusHolder {
  address: string;
  percent?: string;
  is_contract?: number;
  /** GoPlus tag, e.g. "Uniswap V3", "PinkSale Lock", "Burn". */
  tag?: string;
  /** GoPlus flag — tokens locked in a liquidity-locking contract. */
  is_locked?: number;
}

interface GoPlusToken {
  is_honeypot?: string;
  cannot_sell_all?: string;
  holders?: GoPlusHolder[];
}

function toChain(chainId: string): Chain {
  switch (chainId) {
    case "base":
      return "base";
    case "ethereum":
      return "ethereum";
    case "bsc":
      return "bsc";
    case "solana":
      return "solana";
    default:
      return "unknown";
  }
}

/** Common burn addresses — tokens sent here are out of circulation. */
const BURN_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);

/** Map GoPlus's per-holder hints into our compact label vocabulary. */
function preliminaryLabel(h: GoPlusHolder): string | undefined {
  const tag = (h.tag ?? "").toLowerCase();
  if (h.is_locked === 1 || tag.includes("lock")) return "lock";
  if (tag.includes("burn")) return "burn";
  if (BURN_ADDRESSES.has(h.address.toLowerCase())) return "burn";
  // Many DEX names — uniswap, pancake, aerodrome, etc. — surface here too.
  if (tag.includes("uniswap") || tag.includes("aerodrome") || tag.includes("dex")) {
    return "lp";
  }
  if (h.is_contract) return "contract";
  return undefined;
}

/** Overlay the LP-pool labels from DexScreener pair addresses on top of the
 *  preliminary GoPlus labels, and resolve well-known burn addresses. */
function labelHolders(holders: Holder[], pairAddresses: Set<string>): Holder[] {
  return holders.map((h) => {
    const a = h.address.toLowerCase();
    let label = h.label;
    if (pairAddresses.has(a)) label = "lp";
    else if (BURN_ADDRESSES.has(a)) label = "burn";
    return { ...h, label };
  });
}
