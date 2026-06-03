import { Connection, PublicKey } from "@solana/web3.js";
import type { Holder } from "@thesis/shared";
import { config } from "../../config.js";
import { log } from "../../util/log.js";
import type { BaseDataAdapter, PriceSnapshotEth, TokenOnChain } from "./index.js";
import { getPumpFunStatus, type PumpFunStatus } from "./pumpfun-graduation.js";

/**
 * Real Solana token data — DexScreener (price/liquidity/mcap, filtered to
 * Solana pairs) + GoPlus Solana holders (top-10 concentration) + an on-chain
 * pump.fun graduation check (the trust signal). The RealBaseData analogue; same
 * BaseDataAdapter surface.
 *
 * Trust is graduation-gated: `launchpad` is "pumpfun" ONLY when the mint's
 * bonding curve has genuinely completed (LP migrated + locked); otherwise null,
 * which the Auditor scores 0. A graduated pump.fun SPL is a standard,
 * transferable token, so honeypot risk is subsumed — `isHoneypot` is always
 * false (the redundant honeypot factor is removed for Solana).
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
  private readonly connection = new Connection(config.solana.rpcUrl, "confirmed");

  async getToken(mint: string): Promise<TokenOnChain> {
    const [market, topHolders, pumpStatus] = await Promise.all([
      this.fetchMarket(mint),
      this.fetchHolders(mint),
      this.fetchPumpFunStatus(mint),
    ]);
    return {
      contractAddress: mint,
      chain: "solana",
      priceEth: market.priceEth,
      liquidityUsd: market.liquidityUsd,
      marketCapUsd: market.marketCapUsd,
      launchedAt: market.launchedAt,
      // Trust ONLY a genuinely graduated pump.fun curve. on-curve mints and
      // non-pump pools (incl. dev-seeded PumpSwap) → null → Auditor Gate 1 = 0.
      launchpad: pumpStatus === "graduated" ? "pumpfun" : null,
      // A graduated pump.fun SPL is a standard, transferable token — it cannot
      // be a honeypot, so that factor is redundant on Solana. Always false.
      isHoneypot: false,
      topHolders,
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
        } catch (err) {
          log.warn(`basedata: snapshot chunk (size 30) fetch/parse failed — those tokens unpriced this pass: ${String(err)}`);
        }
      }),
    );
    return out;
  }

  async getSnapshotsEth(mints: string[]): Promise<Map<string, PriceSnapshotEth>> {
    const out = new Map<string, PriceSnapshotEth>();
    if (mints.length === 0) return out;
    const pending = Array.from(new Set(mints.map((m) => m.toLowerCase())));
    const chunks: string[][] = [];
    for (let i = 0; i < pending.length; i += 30) chunks.push(pending.slice(i, i + 30));
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
            const priceEth = Number(pool?.priceNative ?? 0);
            if (!(priceEth > 0)) continue;
            const rawMc = Number(pool.marketCap ?? pool.fdv ?? 0);
            const marketCapUsd = Number.isNaN(rawMc) ? 0 : rawMc;
            const symbol = pool.baseToken?.symbol ?? "";
            let logoUrl: string | null = null;
            for (const pr of pairs) {
              if (pr.info?.imageUrl) {
                logoUrl = pr.info.imageUrl;
                break;
              }
            }
            out.set(addr, { priceEth, marketCapUsd, symbol, logoUrl });
          }
        } catch (err) {
          log.warn(`basedata: snapshot chunk (size 30) fetch/parse failed — those tokens unpriced this pass: ${String(err)}`);
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
  }> {
    const res = await fetch(`${DEXSCREENER}/${mint}`);
    if (!res.ok) throw new Error(`DexScreener ${res.status}`);
    const json = (await res.json()) as { pairs?: DexPair[] };
    const solPairs = (json.pairs ?? []).filter((p) => p.chainId === "solana");
    const pool = solPairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    if (!pool) throw new Error(`No Solana DEX pairs found for ${mint}`);
    return {
      priceEth: Number(pool.priceNative ?? 0),
      liquidityUsd: pool.liquidity?.usd ?? 0,
      marketCapUsd: pool.marketCap ?? pool.fdv ?? 0,
      launchedAt: pool.pairCreatedAt
        ? new Date(pool.pairCreatedAt).toISOString()
        : new Date().toISOString(),
    };
  }

  /** GoPlus Solana holders — feeds the Auditor's top-10 concentration gate. The
   *  honeypot signal is intentionally NOT read here: a graduated pump.fun SPL is
   *  a standard transferable token, so honeypot risk is subsumed by the
   *  graduation gate (and forced false at the call site).
   *
   *  On a fetch FAILURE we fall back to empty holders, which the concentration
   *  gate reads as 0% — a GoPlus outage weakens (does not strengthen) that gate.
   *  We log.warn loudly so the outage is never silent; the launchpad
   *  (graduation), age and mcap gates still apply. */
  private async fetchHolders(mint: string): Promise<Holder[]> {
    try {
      const res = await fetch(`${GOPLUS_SOL}?contract_addresses=${mint}`);
      if (!res.ok) {
        log.warn(`basedata(solana): GoPlus ${res.status} for ${mint} — holder data unavailable this check`);
        return [];
      }
      const json = (await res.json()) as { result?: Record<string, GoPlusSolToken> };
      const token = json.result?.[mint];
      if (!token) {
        // Common for a just-launched mint GoPlus hasn't indexed yet — info, not warn.
        log.info(`basedata(solana): GoPlus has no holder record for ${mint} yet`);
        return [];
      }
      return (token.holders ?? []).slice(0, 20).map((h) => ({
        address: h.account ?? h.address ?? "",
        share: Number(h.percent ?? 0),
        label: h.is_locked === 1 ? "lock" : undefined,
      }));
    } catch (err) {
      log.warn(`basedata(solana): holder fetch failed for ${mint} — ${String(err)}`);
      return [];
    }
  }

  /** pump.fun graduation status, read on-chain. Fails CLOSED: if the curve
   *  account can't be read (RPC outage, malformed mint) we cannot confirm
   *  graduation, so we treat the token as untrusted rather than risk buying a
   *  non-graduated (dev-pullable LP) token. */
  private async fetchPumpFunStatus(mint: string): Promise<PumpFunStatus> {
    try {
      return await getPumpFunStatus(this.connection, new PublicKey(mint));
    } catch (err) {
      log.warn(
        `basedata(solana): pump.fun status read failed for ${mint} — ${String(err)}; treating as not graduated`,
      );
      return "not_pumpfun";
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
  info?: { imageUrl?: string };
  pairCreatedAt?: number;
}

interface GoPlusSolHolder {
  account?: string;
  address?: string;
  percent?: string;
  is_locked?: number;
}

interface GoPlusSolToken {
  holders?: GoPlusSolHolder[];
}
