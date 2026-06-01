import type { Holder } from "@thesis/shared";
import { seed } from "../../util/seed.js";
import type { BaseDataAdapter, TokenOnChain } from "./index.js";
import { detectSolanaLaunchpad } from "./solana-launchpad.js";

/**
 * Fake Solana token data, seeded by the mint — the MockBaseData analogue.
 *
 * Mirrors MockBaseData's distributions (liquidity, mcap, holder concentration,
 * age) so the Auditor exercises the same gates on Solana. The launchpad is
 * pump.fun for any mint that carries the "pump" suffix (so the mock feed's
 * pump mints clear the gate); other mints get a seeded mix that includes
 * non-pump launchpads, so the gate's reject path is exercised too. Price is in
 * SOL (the `*Eth` field is native-per-chain).
 */
export class MockSolanaData implements BaseDataAdapter {
  async getToken(mint: string): Promise<TokenOnChain> {
    const liquidityUsd = Math.round(5_000 + seed(mint, "liq") * 430_000);
    const marketCapUsd = Math.round(20_000 + seed(mint, "mc") * 1_900_000);

    const top10 = 0.03 + seed(mint, "conc") * 0.38;
    const weights = [10, 7, 5, 4, 3, 2, 2, 1];
    const wSum = weights.reduce((a, b) => a + b, 0);
    const topHolders: Holder[] = weights.map((w, i) => ({
      address: `Ho1der${i}${mint.slice(0, 8)}`,
      share: (top10 * w) / wSum,
      label: i === 0 ? "deployer" : undefined,
    }));

    const ageHours = seed(mint, "age") ** 2 * 96;
    const launchedAt = new Date(Date.now() - ageHours * 3_600_000).toISOString();

    // A "pump"-suffixed mint is pump.fun; otherwise a seeded mix (so the
    // Auditor's non-pumpfun reject path is exercised on some mints).
    const seededMix = ["pumpfun", "pumpfun", "pumpfun", "raydium"];
    const launchpad =
      detectSolanaLaunchpad(mint) ??
      seededMix[Math.floor(seed(mint, "lp") * seededMix.length)] ??
      null;

    return {
      contractAddress: mint,
      chain: "solana",
      priceEth: 0.0000002 + seed(mint, "price") * 0.0000018,
      liquidityUsd,
      marketCapUsd,
      launchedAt,
      launchpad,
      isHoneypot: seed(mint, "honey") > 0.95,
      topHolders,
    };
  }

  async getPriceEth(mint: string): Promise<number> {
    return 0.0000002 + seed(mint, "price") * 0.0000018;
  }

  async getPricesEth(mints: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const m of mints) out.set(m.toLowerCase(), await this.getPriceEth(m));
    return out;
  }

  async getTokenSymbol(mint: string): Promise<string> {
    return `MOCK${mint.slice(0, 4).toUpperCase()}`;
  }
}
