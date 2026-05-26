/**
 * Adapter: Frontrun API — X-account intelligence (CA history, smart followers).
 *
 * Two implementations behind one interface:
 *   - MockFrontrun  (./mock.ts)  — fake data, $0, no key
 *   - RealFrontrun  (./real.ts)  — the paid API (~$200/mo)
 * The factory picks one based on THESIS_MODE.
 */

import type { PastContract } from "@thesis/shared";
import { useMock } from "../../config.js";
import { MockFrontrun } from "./mock.js";
import { RealFrontrun } from "./real.js";

/** What Frontrun's paid API returns for one X account. */
export interface FrontrunProfile {
  /** The X @handle (without the leading @) the profile was queried by. */
  handle: string;
  /** Number of "smart" / KOL accounts that follow this user. */
  kolFollowerCount: number;
  kolFollowers: string[];
  /** Contract addresses this account has posted (CA history). */
  caHistory: PastContract[];
  /** Past X @handles (rename history). */
  renameHistory: string[];
  /** Wallets linked to this X account. */
  linkedWallets: string[];
}

export interface FrontrunAdapter {
  /** Look up a single X account's intelligence profile by its @handle. */
  getProfile(handle: string): Promise<FrontrunProfile>;
}

/** Returns the mock or real adapter depending on THESIS_MODE. */
export function createFrontrunAdapter(): FrontrunAdapter {
  return useMock() ? new MockFrontrun() : new RealFrontrun();
}
