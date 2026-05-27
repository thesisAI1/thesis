import type { Holder } from "@thesis/shared";
import { config } from "../../config.js";
import { log } from "../../util/log.js";
import type { BaseDataAdapter, TokenOnChain } from "./index.js";

/**
 * Birdeye-backed Base data adapter.
 *
 * Replaces DexScreener for price + market data with a paid feed that:
 *   - returns sub-second prices (vs DexScreener's 5-15s caching)
 *   - has no per-process 429 throttling at our scale
 *   - delivers richer history (1m/5m/30m/1h price + volume)
 *
 * Three rate-limit-aware optimisations are baked in:
 *   1. The ETH/USD reference price comes from the SAME multi_price call as
 *      the token prices (WETH is folded into the address list), so the
 *      monitor's per-tick request count is exactly 1.
 *   2. Prices are cached for 12 seconds — fine-grained enough that a TP/SL
 *      hit doesn't lag, but coarse enough that overlapping monitor ticks
 *      reuse the result instead of re-hitting the API.
 *   3. Tokens that multi_price omits (typically just-launched Clanker tokens
 *      Birdeye hasn't indexed yet) fall back to /defi/price single — costs
 *      one extra call only for the rare unindexed token.
 *
 * Holders and honeypot detection are intentionally NOT surfaced — the
 * Auditor's launchpad gate (Clanker or Bankr only) already covers the rug
 * risk those checks were guarding against.
 *
 * Launchpad detection:
 *   - Bankr → its own public fee endpoint (HTTP 200 with non-error body)
 *   - Clanker → Blockscout V2 contract metadata. Clanker-deployed tokens are
 *     verified on Base with a Solidity class name starting with "Clanker"
 *     (e.g. "ClankerToken" for v4). The old deployer-vs-factory check is kept
 *     as a secondary path for when a paid BaseScan plan is configured, but
 *     Blockscout is the source that actually works on the free tier.
 *
 * launchedAt has a 3-tier fallback chain because no single source is reliable
 * on Base:
 *   1. BaseScan contract creation timestamp — the source of truth, but the
 *      free Etherscan v2 plan does NOT support Base, so this returns null
 *      unless a paid plan key is configured.
 *   2. DexScreener pairCreatedAt of the earliest base pair — free, accurate
 *      for any token that has an indexed liquidity pair (which every tradable
 *      token does). This is the de-facto primary source today.
 *   3. Birdeye overview launchedAt — which is just `new Date()` at fetch
 *      time, so it makes everything look <1h old. Only used if both above fail.
 */
const BIRDEYE_API = "https://public-api.birdeye.so";
const BANKR_LAUNCHES = "https://api.bankr.bot/token-launches";
const ETHERSCAN_V2 = "https://api.etherscan.io/v2/api";
const DEXSCREENER_API = "https://api.dexscreener.com";
const BLOCKSCOUT_BASE = "https://base.blockscout.com";
const WETH_BASE = "0x4200000000000000000000000000000000000006";
const PRICE_CACHE_TTL_MS = 30_000;
const RATE_LIMIT_BACKOFF_MS = 2_000;

/** Clanker token-factory contracts on Base (v0-v4). */
const CLANKER_FACTORIES = new Set([
  "0xe85a59c628f7d27878aceb4bf3b35733630083a9",
  "0x2a787b2362021cc3eea3c24c4748a6cd5b687382",
  "0x375c15db32d28cecdcab5c03ab889bf15cbd2c5e",
  "0x732560fa1d1a76350b1a500155ba978031b53833",
  "0x9b84fce5dcd9a38d2d01d5d72373f6b6b067c3e1",
  "0x250c9fb2b411b48273f69879007803790a6aea47",
]);

interface CachedPrice {
  priceEth: number;
  at: number;
}

export class BirdeyeBaseData implements BaseDataAdapter {
  private readonly headers: Record<string, string>;
  /** In-process price cache keyed by lowercased address. Survives the
   *  monitor → endowment → dashboard chain so we don't hammer Birdeye. */
  private static readonly priceCache = new Map<string, CachedPrice>();

  constructor() {
    if (!config.baseData.birdeyeKey) {
      throw new Error("BIRDEYE_API_KEY is required for the Birdeye adapter.");
    }
    this.headers = {
      "X-API-KEY": config.baseData.birdeyeKey,
      "x-chain": "base",
    };
  }

  async getToken(address: string): Promise<TokenOnChain> {
    // Birdeye gives us price / liquidity / mcap but NOT a launch date and no
    // deployer info. BaseScan is the source of truth for the creation timestamp
    // but the free Etherscan v2 plan rejects Base, so DexScreener pairCreatedAt
    // is fetched in parallel as a free fallback. All three calls are run in
    // parallel so the slowest one (typically DexScreener) sets the latency.
    const [overview, creation, dexLaunchedAt] = await Promise.all([
      this.fetchOverview(address),
      this.fetchCreationInfo(address),
      this.fetchDexScreenerLaunchedAt(address),
    ]);
    const launchpad = await this.classifyLaunchpad(address, creation?.deployer ?? null);
    // Prefer BaseScan (exact contract creation), fall back to DexScreener
    // (earliest pair created — usually within seconds of the token deploy on
    // launchpads like Clanker / Bankr), then finally to overview.launchedAt
    // which is just now() and would make every token look brand new.
    const launchedAt = creation?.launchedAt ?? dexLaunchedAt ?? overview.launchedAt;
    return {
      contractAddress: address,
      chain: "base",
      priceEth: overview.priceEth,
      liquidityUsd: overview.liquidityUsd,
      marketCapUsd: overview.marketCapUsd,
      launchedAt,
      launchpad,
      isHoneypot: false,
      topHolders: [] as Holder[],
    };
  }

  async getPriceEth(address: string): Promise<number> {
    const cached = readCache(address);
    if (cached !== undefined) return cached;
    const prices = await this.getPricesEth([address]);
    return prices.get(address.toLowerCase()) ?? 0;
  }

  async getPricesEth(addresses: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (addresses.length === 0) return out;

    // Serve from cache first, surface only the cache misses to the API.
    const missing: string[] = [];
    for (const a of addresses) {
      const cached = readCache(a);
      if (cached !== undefined) out.set(a.toLowerCase(), cached);
      else missing.push(a);
    }
    if (missing.length === 0) return out;

    // Fold WETH into the same multi_price call to get the ETH/USD reference
    // without a second round-trip. Birdeye accepts up to 100 addresses per call.
    const chunks: string[][] = [];
    const dedup = Array.from(new Set([...missing, WETH_BASE].map((a) => a.toLowerCase())));
    for (let i = 0; i < dedup.length; i += 100) chunks.push(dedup.slice(i, i + 100));

    const raw: Record<string, number> = {};
    for (const chunk of chunks) {
      const data = await this.fetchMultiPrice(chunk);
      for (const [addr, info] of Object.entries(data)) {
        const usd = Number(info?.value ?? 0);
        if (usd > 0) raw[addr.toLowerCase()] = usd;
      }
    }

    const ethUsd = raw[WETH_BASE.toLowerCase()] ?? 0;
    if (ethUsd <= 0) {
      // No ETH/USD reference — return whatever cache held. The monitor will
      // skip positions without a fresh price and retry on the next tick.
      return out;
    }

    for (const addr of missing) {
      const key = addr.toLowerCase();
      const usd = raw[key];
      // Tokens not returned by multi_price (typically just-launched Clanker
      // tokens Birdeye hasn't indexed) are intentionally skipped — calling
      // /defi/price single per miss would multiply our request count and
      // re-trigger the rate limit.
      if (!usd) continue;
      const priceEth = usd / ethUsd;
      out.set(key, priceEth);
      writeCache(addr, priceEth);
    }
    return out;
  }

  /** One multi_price call with a single retry on 429 (Birdeye's burst-rate
   *  protection). The 2s backoff is enough for the per-second window to roll. */
  private async fetchMultiPrice(
    chunk: string[],
  ): Promise<Record<string, { value?: number } | null>> {
    const url = `${BIRDEYE_API}/defi/multi_price?list_address=${encodeURIComponent(chunk.join(","))}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch(url, { headers: this.headers });
        if (res.status === 429 && attempt === 0) {
          await new Promise((r) => setTimeout(r, RATE_LIMIT_BACKOFF_MS));
          continue;
        }
        if (!res.ok) {
          log.warn(`Birdeye /defi/multi_price ${res.status} — skipping tick`);
          return {};
        }
        const json = (await res.json()) as {
          success?: boolean;
          data?: Record<string, { value?: number } | null>;
        };
        return json.data ?? {};
      } catch (err) {
        log.warn(`Birdeye multi_price fetch failed: ${String(err)}`);
        return {};
      }
    }
    return {};
  }

  async getTokenSymbol(address: string): Promise<string> {
    try {
      const o = await this.fetchOverviewRaw(address);
      return o.symbol ?? "";
    } catch {
      return "";
    }
  }

  private async fetchOverview(address: string): Promise<{
    priceEth: number;
    liquidityUsd: number;
    marketCapUsd: number;
    launchedAt: string;
  }> {
    // For the Auditor's token snapshot we don't strictly need ETH-denominated
    // price (it uses USD market cap), so leave priceEth at zero if we'd have
    // to make a second API call to convert. The monitor's own price loop is
    // what feeds the TP/SL ladder.
    const raw = await this.fetchOverviewRaw(address);
    return {
      priceEth: 0,
      liquidityUsd: raw.liquidityUsd ?? 0,
      marketCapUsd: raw.marketCapUsd ?? 0,
      launchedAt: raw.launchedAt ?? new Date().toISOString(),
    };
  }

  private async fetchOverviewRaw(address: string): Promise<{
    symbol?: string;
    priceUsd?: number;
    liquidityUsd?: number;
    marketCapUsd?: number;
    launchedAt?: string;
  }> {
    const res = await fetch(`${BIRDEYE_API}/defi/token_overview?address=${address}`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`Birdeye /defi/token_overview ${res.status}`);
    const json = (await res.json()) as {
      success?: boolean;
      data?: {
        symbol?: string;
        price?: number;
        liquidity?: number;
        mc?: number;
        marketCap?: number;
      };
    };
    const d = json.data ?? {};
    return {
      symbol: d.symbol,
      priceUsd: d.price,
      liquidityUsd: d.liquidity,
      marketCapUsd: d.marketCap ?? d.mc,
    };
  }

  /** Classify launchpad. Bankr first via its own public fee endpoint; then
   *  Clanker via two signals — (a) on-chain deployer matching one of the
   *  factory contracts (only works when a paid BaseScan plan supplies the
   *  deployer), (b) Blockscout-verified contract name starting with "Clanker"
   *  (works on the free tier and is the path used in production today). */
  private async classifyLaunchpad(
    address: string,
    deployer: string | null,
  ): Promise<string | null> {
    try {
      const res = await fetch(`${BANKR_LAUNCHES}/${address}/fees`);
      if (res.ok) {
        const json = (await res.json()) as { error?: unknown };
        if (json && json.error === undefined) return "bankr";
      }
    } catch {
      /* ignore */
    }
    if (deployer && CLANKER_FACTORIES.has(deployer.toLowerCase())) return "clanker";
    const contractName = await this.fetchBlockscoutContractName(address);
    if (contractName && /^clanker/i.test(contractName)) return "clanker";
    return null;
  }

  /** Fetch the verified Solidity class name of a contract from Blockscout's
   *  V2 API. Used for Clanker detection — every Clanker-launched token is
   *  source-verified with a class name starting with "Clanker" (e.g.
   *  "ClankerToken" for v4 deployments). Free, no API key, supports Base. */
  private async fetchBlockscoutContractName(address: string): Promise<string | null> {
    try {
      const res = await fetch(`${BLOCKSCOUT_BASE}/api/v2/addresses/${address}`);
      if (!res.ok) return null;
      const json = (await res.json()) as { name?: string | null };
      return json.name ?? null;
    } catch {
      return null;
    }
  }

  /** One BaseScan call → both the deployer (for launchpad classification) and
   *  the contract creation timestamp (for the Auditor's age gate). Birdeye
   *  doesn't expose either, so this is the source of truth for both. */
  private async fetchCreationInfo(
    address: string,
  ): Promise<{ deployer: string | null; launchedAt: string | null } | null> {
    if (!config.auditor.basescanApiKey) return null;
    const url =
      `${ETHERSCAN_V2}?chainid=8453&module=contract&action=getcontractcreation` +
      `&contractaddresses=${address}&apikey=${config.auditor.basescanApiKey}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const json = (await res.json()) as {
        result?: Array<{
          contractCreator?: string;
          timestamp?: string;
          /** Newer BaseScan responses sometimes use blockNumber + a separate
           *  block lookup; we fall back to the txHash route if timestamp is
           *  missing. For now this single field is what Etherscan v2 ships. */
        }>;
      };
      const entry = json.result?.[0];
      if (!entry) return null;
      const ts = Number(entry.timestamp ?? 0);
      const launchedAt = ts > 0 ? new Date(ts * 1000).toISOString() : null;
      return { deployer: entry.contractCreator ?? null, launchedAt };
    } catch {
      return null;
    }
  }

  /** Fallback launch timestamp via DexScreener. We pick the earliest
   *  `pairCreatedAt` across all base pairs because Clanker / Bankr deploys
   *  spawn the first pool atomically with the token, so the first pair
   *  creation tracks the actual token launch within a few seconds. Returns
   *  null if DexScreener hasn't indexed the token yet (typical only for
   *  brand-new launches, in which case the Auditor's age gate would block
   *  it anyway under the under-1h rule). */
  private async fetchDexScreenerLaunchedAt(address: string): Promise<string | null> {
    try {
      const res = await fetch(`${DEXSCREENER_API}/latest/dex/tokens/${address}`);
      if (!res.ok) return null;
      const json = (await res.json()) as {
        pairs?: Array<{ chainId?: string; pairCreatedAt?: number }>;
      };
      const basePairs = (json.pairs ?? []).filter((p) => p.chainId === "base");
      let earliest = Number.POSITIVE_INFINITY;
      for (const p of basePairs) {
        const ts = Number(p.pairCreatedAt ?? 0);
        if (ts > 0 && ts < earliest) earliest = ts;
      }
      if (!Number.isFinite(earliest)) return null;
      return new Date(earliest).toISOString();
    } catch {
      return null;
    }
  }
}

function readCache(address: string): number | undefined {
  const hit = BirdeyeBaseData["priceCache"].get(address.toLowerCase());
  if (!hit) return undefined;
  if (Date.now() - hit.at > PRICE_CACHE_TTL_MS) {
    BirdeyeBaseData["priceCache"].delete(address.toLowerCase());
    return undefined;
  }
  return hit.priceEth;
}

function writeCache(address: string, priceEth: number): void {
  BirdeyeBaseData["priceCache"].set(address.toLowerCase(), {
    priceEth,
    at: Date.now(),
  });
}
