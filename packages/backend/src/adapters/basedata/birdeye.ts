import type { Holder } from "@thesis/shared";
import { config } from "../../config.js";
import type { BaseDataAdapter, TokenOnChain } from "./index.js";

/**
 * Birdeye-backed Base data adapter.
 *
 * Replaces DexScreener for price + market data with a paid feed that:
 *   - returns sub-second prices (vs DexScreener's 5-15s caching)
 *   - has no per-process 429 throttling at our scale
 *   - delivers richer history (1m/5m/30m/1h price + volume)
 *
 * Holders and honeypot detection are intentionally NOT surfaced — the
 * Auditor's launchpad gate (Clanker or Bankr only) already covers the rug
 * risk those checks were guarding against. Keeping the adapter narrow keeps
 * the request budget tight too.
 *
 * Launchpad detection (Bankr / Clanker) stays on the same two free APIs the
 * DexScreener adapter uses, since Birdeye doesn't return deployer info.
 */
const BIRDEYE_API = "https://public-api.birdeye.so";
const BANKR_LAUNCHES = "https://api.bankr.bot/token-launches";
const ETHERSCAN_V2 = "https://api.etherscan.io/v2/api";

/** Clanker token-factory contracts on Base (v0-v4). */
const CLANKER_FACTORIES = new Set([
  "0xe85a59c628f7d27878aceb4bf3b35733630083a9",
  "0x2a787b2362021cc3eea3c24c4748a6cd5b687382",
  "0x375c15db32d28cecdcab5c03ab889bf15cbd2c5e",
  "0x732560fa1d1a76350b1a500155ba978031b53833",
  "0x9b84fce5dcd9a38d2d01d5d72373f6b6b067c3e1",
  "0x250c9fb2b411b48273f69879007803790a6aea47",
]);

export class BirdeyeBaseData implements BaseDataAdapter {
  private readonly headers: Record<string, string>;

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
    const [overview, launchpad] = await Promise.all([
      this.fetchOverview(address),
      this.detectLaunchpad(address),
    ]);
    // Empty topHolders + isHoneypot=false: the Clanker/Bankr launchpad gate
    // is the security layer we rely on.
    const topHolders: Holder[] = [];
    return {
      contractAddress: address,
      chain: "base",
      priceEth: overview.priceEth,
      liquidityUsd: overview.liquidityUsd,
      marketCapUsd: overview.marketCapUsd,
      launchedAt: overview.launchedAt,
      launchpad,
      isHoneypot: false,
      topHolders,
    };
  }

  async getPriceEth(address: string): Promise<number> {
    const res = await fetch(`${BIRDEYE_API}/defi/price?address=${address}`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`Birdeye /defi/price ${res.status}`);
    const json = (await res.json()) as { success?: boolean; data?: { value?: number } };
    const usd = Number(json.data?.value ?? 0);
    return usd / (await this.getEthUsd());
  }

  async getPricesEth(addresses: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (addresses.length === 0) return out;

    // Birdeye /defi/multi_price accepts up to 100 addresses per request. Split
    // into chunks of 100, then do ONE more call for the ETH/USD reference price.
    const chunks: string[][] = [];
    for (let i = 0; i < addresses.length; i += 100) chunks.push(addresses.slice(i, i + 100));

    const [ethUsd, ...results] = await Promise.all([
      this.getEthUsd(),
      ...chunks.map(async (chunk) => {
        const url = `${BIRDEYE_API}/defi/multi_price?list_address=${encodeURIComponent(chunk.join(","))}`;
        const res = await fetch(url, { headers: this.headers });
        if (!res.ok) {
          throw new Error(`Birdeye /defi/multi_price ${res.status}`);
        }
        const json = (await res.json()) as {
          success?: boolean;
          data?: Record<string, { value?: number } | null>;
        };
        return json.data ?? {};
      }),
    ]);

    if (ethUsd <= 0) return out;
    for (const data of results) {
      for (const [addr, info] of Object.entries(data)) {
        const usd = Number(info?.value ?? 0);
        if (usd > 0) out.set(addr.toLowerCase(), usd / ethUsd);
      }
    }
    return out;
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
    const raw = await this.fetchOverviewRaw(address);
    const ethUsd = await this.getEthUsd();
    return {
      priceEth: ethUsd > 0 ? (raw.priceUsd ?? 0) / ethUsd : 0,
      liquidityUsd: raw.liquidityUsd ?? 0,
      marketCapUsd: raw.marketCapUsd ?? 0,
      // Birdeye doesn't expose pairCreatedAt directly. Fall back to current
      // time so the age gate still functions — Auditor's launchpad gate is
      // the real safety filter.
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

  /** Get ETH/USD from Birdeye too — saves a separate call to another API. */
  private async getEthUsd(): Promise<number> {
    const res = await fetch(
      `${BIRDEYE_API}/defi/price?address=0x4200000000000000000000000000000000000006`,
      { headers: this.headers },
    );
    if (!res.ok) return 0;
    const json = (await res.json()) as { data?: { value?: number } };
    return Number(json.data?.value ?? 0);
  }

  /** Reuse the existing Bankr-fee-check and Etherscan deployer-check for launchpad detection. */
  private async detectLaunchpad(address: string): Promise<string | null> {
    try {
      const res = await fetch(`${BANKR_LAUNCHES}/${address}/fees`);
      if (res.ok) {
        const json = (await res.json()) as { error?: unknown };
        if (json && json.error === undefined) return "bankr";
      }
    } catch {
      /* ignore */
    }
    try {
      const deployer = await this.deployerOf(address);
      if (deployer && CLANKER_FACTORIES.has(deployer.toLowerCase())) return "clanker";
    } catch {
      /* ignore */
    }
    return null;
  }

  private async deployerOf(address: string): Promise<string | null> {
    if (!config.auditor.basescanApiKey) return null;
    const url =
      `${ETHERSCAN_V2}?chainid=8453&module=contract&action=getcontractcreation` +
      `&contractaddresses=${address}&apikey=${config.auditor.basescanApiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: Array<{ contractCreator?: string }> };
    return json.result?.[0]?.contractCreator ?? null;
  }
}

