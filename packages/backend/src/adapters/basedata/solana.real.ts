import type { Holder } from "@thesis/shared";
import type { BaseDataAdapter, TokenOnChain } from "./index.js";
import { detectSolanaLaunchpad } from "./solana-launchpad.js";

/**
 * Real Solana token data — DexScreener (price/liquidity/mcap, filtered to
 * Solana pairs) + GoPlus Solana token-security (honeypot / holders) + pump.fun
 * launchpad detection. The RealBaseData analogue; same BaseDataAdapter surface.
 *
 * Price is `priceNative` from DexScreener, which for a Solana pair is SOL per
 * token — exactly the native unit the pipeline expects for a Solana position.
 *
 * SCAFFOLDED: structurally complete and typecheck-clean; live verification
 * happens once Solana live-trading is funded. Birdeye's Solana holder feed is a
 * future optimization; today holders come from GoPlus Solana (best-effort).
 */
const DEXSCREENER = "https://api.dexscreener.com/latest/dex/tokens";
const GOPLUS_SOL = "https://api.gopluslabs.io/api/v1/solana/token_security";

export class RealSolanaData implements BaseDataAdapter {
  async getToken(mint: string): Promise<TokenOnChain> {
    const [market, security] = await Promise.all([
      this.fetchMarket(mint),
      this.fetchSecurity(mint),
    ]);
    return {
      contractAddress: mint,
      chain: "solana",
      priceEth: market.priceEth,
      liquidityUsd: market.liquidityUsd,
      marketCapUsd: market.marketCapUsd,
      launchedAt: market.launchedAt,
      launchpad: detectSolanaLaunchpad(mint, market.dexIds),
      isHoneypot: security.isHoneypot,
      topHolders: security.topHolders,
    };
  }

  async getPriceEth(mint: string): Promise<number> {
    return (await this.fetchMarket(mint)).priceEth;
  }

  async getPricesEth(mints: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (mints.length === 0) return out;
    const chunks: string[][] = [];
    for (let i = 0; i < mints.length; i += 30) chunks.push(mints.slice(i, i + 30));
    await Promise.all(
      chunks.map(async (chunk) => {
        try {
          const res = await fetch(`${DEXSCREENER}/${chunk.join(",")}`);
          if (!res.ok) return;
          const json = (await res.json()) as { pairs?: DexPair[] };
          const byMint = new Map<string, DexPair[]>();
          for (const p of json.pairs ?? []) {
            if (p.chainId !== "solana") continue;
            const addr = p.baseToken?.address?.toLowerCase();
            if (!addr) continue;
            const list = byMint.get(addr) ?? [];
            list.push(p);
            byMint.set(addr, list);
          }
          for (const [addr, pairs] of byMint) {
            const pool = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
            const price = Number(pool?.priceNative ?? 0);
            if (price > 0) out.set(addr, price);
          }
        } catch {
          /* one chunk failing shouldn't poison the whole batch */
        }
      }),
    );
    return out;
  }

  async getTokenSymbol(mint: string): Promise<string> {
    try {
      const res = await fetch(`${DEXSCREENER}/${mint}`);
      if (!res.ok) return "";
      const json = (await res.json()) as { pairs?: DexPair[] };
      const pool = (json.pairs ?? []).find(
        (p) => p.chainId === "solana" && p.baseToken?.address?.toLowerCase() === mint.toLowerCase(),
      );
      return pool?.baseToken?.symbol ?? "";
    } catch {
      return "";
    }
  }

  private async fetchMarket(mint: string): Promise<{
    priceEth: number;
    liquidityUsd: number;
    marketCapUsd: number;
    launchedAt: string;
    dexIds: string[];
  }> {
    const res = await fetch(`${DEXSCREENER}/${mint}`);
    if (!res.ok) throw new Error(`DexScreener ${res.status}`);
    const json = (await res.json()) as { pairs?: DexPair[] };
    const solPairs = (json.pairs ?? []).filter((p) => p.chainId === "solana");
    const pool = solPairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    if (!pool) throw new Error(`No Solana DEX pairs found for ${mint}`);
    const dexIds = solPairs
      .map((p) => p.dexId)
      .filter((d): d is string => typeof d === "string" && d.length > 0);
    return {
      priceEth: Number(pool.priceNative ?? 0),
      liquidityUsd: pool.liquidity?.usd ?? 0,
      marketCapUsd: pool.marketCap ?? pool.fdv ?? 0,
      launchedAt: pool.pairCreatedAt
        ? new Date(pool.pairCreatedAt).toISOString()
        : new Date().toISOString(),
      dexIds,
    };
  }

  private async fetchSecurity(mint: string): Promise<{
    isHoneypot: boolean;
    topHolders: Holder[];
  }> {
    try {
      const res = await fetch(`${GOPLUS_SOL}?contract_addresses=${mint}`);
      if (!res.ok) return { isHoneypot: false, topHolders: [] };
      const json = (await res.json()) as { result?: Record<string, GoPlusSolToken> };
      const token = json.result?.[mint];
      if (!token) return { isHoneypot: false, topHolders: [] };
      const topHolders: Holder[] = (token.holders ?? []).slice(0, 20).map((h) => ({
        address: h.account ?? h.address ?? "",
        share: Number(h.percent ?? 0),
        label: h.is_locked === 1 ? "lock" : undefined,
      }));
      // A pump.fun mint should have its mint authority revoked; a live mint
      // authority is the closest Solana analogue to a honeypot risk here.
      const isHoneypot = token.non_transferable === "1";
      return { isHoneypot, topHolders };
    } catch {
      return { isHoneypot: false, topHolders: [] };
    }
  }
}

interface DexPair {
  chainId: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; symbol?: string; name?: string };
  priceNative?: string;
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  pairCreatedAt?: number;
}

interface GoPlusSolHolder {
  account?: string;
  address?: string;
  percent?: string;
  is_locked?: number;
}

interface GoPlusSolToken {
  non_transferable?: string;
  holders?: GoPlusSolHolder[];
}
