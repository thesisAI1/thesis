import type { PastContract } from "@thesis/shared";
import { seed } from "../../util/seed.js";
import type { FrontrunAdapter, FrontrunProfile } from "./index.js";

/**
 * Fake Frontrun data, seeded by the X @handle — so each mock author has a
 * stable but distinct profile (some strong, some thin, some bot-like).
 */
export class MockFrontrun implements FrontrunAdapter {
  async getProfile(handle: string): Promise<FrontrunProfile> {
    const clean = handle.replace(/^@/, "");
    const kolFollowerCount = Math.floor(seed(clean, "reach") * 240);
    const callCount = Math.floor(seed(clean, "calls") * 5);

    const caHistory: PastContract[] = [];
    for (let i = 0; i < callCount; i++) {
      caHistory.push({
        address: `0xPAST${clean.replace(/\W/g, "")}${i}`,
        chain: "base",
        postedAt: new Date(Date.now() - (i + 1) * 6 * 86_400_000).toISOString(),
        performanceX: Number((seed(clean, `perf${i}`) * 6).toFixed(2)),
      });
    }

    return {
      handle: clean,
      kolFollowerCount,
      kolFollowers: [],
      caHistory,
      renameHistory: [],
      linkedWallets: [],
    };
  }
}
