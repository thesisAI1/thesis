import type { Holder } from "@thesis/shared";
import { seed } from "../../util/seed.js";
import type { BaseDataAdapter, TokenOnChain } from "./index.js";

/** Fake on-chain data, seeded by the contract address — so each token differs. */
export class MockBaseData implements BaseDataAdapter {
  async getToken(address: string): Promise<TokenOnChain> {
    const liquidityUsd = Math.round(5_000 + seed(address, "liq") * 430_000);
    const marketCapUsd = Math.round(20_000 + seed(address, "mc") * 1_900_000);

    // Top-10 concentration ~3%-41%, split across 8 holders.
    const top10 = 0.03 + seed(address, "conc") * 0.38;
    const weights = [10, 7, 5, 4, 3, 2, 2, 1];
    const wSum = weights.reduce((a, b) => a + b, 0);
    const topHolders: Holder[] = weights.map((w, i) => ({
      address: `0xHLD${i}${address.slice(2, 10)}`,
      share: (top10 * w) / wSum,
      label: i === 0 ? "deployer" : undefined,
    }));

    // Token age — most are hours/days old, some launched in the last hour.
    const ageHours = seed(address, "age") ** 2 * 96;
    const launchedAt = new Date(Date.now() - ageHours * 3_600_000).toISOString();

    // Launchpad — most via Clanker/Bankr, some launched outside them.
    const launchpads = ["clanker", "bankr", "clanker", "uniswap"];

    return {
      contractAddress: address,
      chain: "base",
      priceEth: 0.0000002 + seed(address, "price") * 0.0000018,
      liquidityUsd,
      marketCapUsd,
      launchedAt,
      launchpad: launchpads[Math.floor(seed(address, "lp") * launchpads.length)] ?? null,
      isHoneypot: seed(address, "honey") > 0.9,
      topHolders,
    };
  }

  async getPriceEth(address: string): Promise<number> {
    return 0.0000002 + seed(address, "price") * 0.0000018;
  }

  async getPricesEth(addresses: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const a of addresses) out.set(a.toLowerCase(), await this.getPriceEth(a));
    return out;
  }

  async getTokenSymbol(address: string): Promise<string> {
    return `MOCK${address.slice(2, 6).toUpperCase()}`;
  }
}
