import type { Holder } from "@thesis/shared";
import { log } from "../../util/log.js";
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

  /** Live market cap (USD) straight from DexScreener's own `marketCap` (fdv
   *  fallback), batched 30/call — the SAME number the public page shows. Mirrors
   *  getPricesEth's pool pick (Solana pairs, deepest liquidity). */
  async getLiveMarketCapsUsd(mints: string[]): Promise<Map<string, number>> {
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
            const mc = pool?.marketCap ?? pool?.fdv ?? 0;
            if (mc > 0) out.set(addr, mc);
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
    // NOTE: on a fetch FAILURE we fall back to empty security data, which the
    // Auditor's top-10-concentration gate reads as 0% — i.e. a GoPlus outage
    // weakens (does not strengthen) that gate. We log.warn loudly so the outage
    // is never silent; the launchpad (pump.fun), age, and mcap gates still apply.
    // A future hardening can thread an explicit "security unknown" signal into
    // TokenOnChain so the concentration gate fails closed.
    try {
      const res = await fetch(`${GOPLUS_SOL}?contract_addresses=${mint}`);
      if (!res.ok) {
        log.warn(`basedata(solana): GoPlus ${res.status} for ${mint} — security data unavailable this check`);
        return { isHoneypot: false, topHolders: [] };
      }
      const json = (await res.json()) as { result?: Record<string, GoPlusSolToken> };
      const token = json.result?.[mint];
      if (!token) {
        // Common for a just-launched mint GoPlus hasn't indexed yet — info, not warn.
        log.info(`basedata(solana): GoPlus has no security record for ${mint} yet`);
        return { isHoneypot: false, topHolders: [] };
      }
      const topHolders: Holder[] = (token.holders ?? []).slice(0, 20).map((h) => ({
        address: h.account ?? h.address ?? "",
        share: Number(h.percent ?? 0),
        label: h.is_locked === 1 ? "lock" : undefined,
      }));
      // Honeypot proxy: `non_transferable` means the SPL token cannot be
      // transferred at all — i.e. holders can't sell — which is the Solana
      // analogue of an EVM honeypot. (This is NOT the mint-authority field;
      // a live mint authority is a separate dilution risk, not modelled here.)
      const isHoneypot = token.non_transferable === "1";
      return { isHoneypot, topHolders };
    } catch (err) {
      log.warn(`basedata(solana): security fetch failed for ${mint} — ${String(err)}`);
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
