/**
 * Real Frontrun API client.
 *
 * Frontrun's paid API exposes a separate endpoint per signal, each charged
 * in credits. The Basic plan is 300k credits/month. To stay well inside that
 * budget we only call the two cheapest endpoints that materially feed the
 * Registrar's score:
 *
 *   - smart-followers/count   (3 credits)  -> kolFollowerCount
 *   - tweets-with-ca-cache    (50 credits) -> caHistory (past contracts)
 *
 * Total: ~53 credits per review, ~5,600 reviews/month at the Basic plan.
 *
 * Pricier endpoints (associated-wallets at 400, username-history at 40) are
 * deliberately skipped — they add a lot of cost for marginal scoring value.
 * The two calls run in parallel and degrade independently: if one fails, the
 * profile is still returned with the other half filled in.
 *
 * Docs (private Notion): the Frontrun API uses the X @handle (not numeric id)
 * and returns `{ data, code, status, message }` wrappers.
 */

import type { Chain, PastContract } from "@thesis/shared";
import { config } from "../../config.js";
import { log } from "../../util/log.js";
import type { FrontrunAdapter, FrontrunProfile } from "./index.js";

const BASE_PATH = "/api/v1/pro/twitter";

interface SmartFollowersCountResponse {
  data?: { totalCount?: number } | null;
  code?: number;
  status?: boolean;
  message?: string;
}

interface TweetWithCa {
  tweetId?: string;
  twitterHandle?: string;
  chain?: string;
  ca?: string;
  content?: string;
  isDeleted?: boolean;
  tweetTime?: string;
}

/** The cache endpoint wraps the real payload one level deeper inside `data.data`,
 *  next to a `cacheHit` flag. The non-cache endpoint puts the payload flat under
 *  `data`. We accept both shapes so the adapter works either way. */
interface TweetsWithCaPayload {
  source?: string;
  topUndeletedTweets?: TweetWithCa[] | null;
  topDeletedTweets?: TweetWithCa[] | null;
}

interface TweetsWithCaResponse {
  data?:
    | (TweetsWithCaPayload & { cacheHit?: boolean; data?: TweetsWithCaPayload | null })
    | null;
  code?: number;
  status?: boolean;
  message?: string;
}

export class RealFrontrun implements FrontrunAdapter {
  async getProfile(handle: string): Promise<FrontrunProfile> {
    if (!config.frontrun.apiKey) {
      throw new Error("FRONTRUN_API_KEY is required for the live Frontrun adapter.");
    }
    const cleanHandle = handle.replace(/^@/, "");

    // Both lookups in parallel; each degrades to a sensible default on failure
    // so a single hiccup never zeros out the whole profile.
    const [kolFollowerCount, caHistory] = await Promise.all([
      this.fetchSmartFollowerCount(cleanHandle).catch((err) => {
        log.warn(`frontrun: smart-followers/count failed for ${cleanHandle}: ${String(err)}`);
        return 0;
      }),
      this.fetchCaHistory(cleanHandle).catch((err) => {
        log.warn(`frontrun: tweets-with-ca-cache failed for ${cleanHandle}: ${String(err)}`);
        return [] as PastContract[];
      }),
    ]);

    return {
      handle: cleanHandle,
      kolFollowerCount,
      kolFollowers: [],
      caHistory,
      renameHistory: [],
      linkedWallets: [],
    };
  }

  private async fetchSmartFollowerCount(handle: string): Promise<number> {
    const url =
      `${config.frontrun.apiBase}${BASE_PATH}/${encodeURIComponent(handle)}/smart-followers/count`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`Frontrun smart-followers/count ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as SmartFollowersCountResponse;
    return json.data?.totalCount ?? 0;
  }

  private async fetchCaHistory(handle: string): Promise<PastContract[]> {
    // The cache endpoint may return data=null on first hit (warming a crawl).
    // We treat that as "no data yet" — next review of the same author benefits.
    const url =
      `${config.frontrun.apiBase}${BASE_PATH}/${encodeURIComponent(handle)}/tweets-with-ca-cache`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`Frontrun tweets-with-ca-cache ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as TweetsWithCaResponse;
    // Cache endpoint nests the payload inside `data.data`; fall back to flat
    // `data` for the non-cache endpoint or if the wrapper ever flattens.
    const payload = json.data?.data ?? json.data ?? null;
    const tweets = payload?.topUndeletedTweets ?? [];
    return tweets
      .filter((t): t is TweetWithCa & { ca: string } => typeof t.ca === "string" && t.ca.length > 0)
      .map((t) => ({
        address: t.ca,
        chain: mapChain(t.chain),
        postedAt: t.tweetTime ?? "",
        // The endpoint does not return per-call performance; the Registrar's
        // scoring tolerates missing performanceX (see registrar.ts).
        performanceX: undefined,
      }));
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${config.frontrun.apiKey}`,
      accept: "application/json",
    };
  }
}

function mapChain(chain: string | undefined): Chain {
  switch ((chain ?? "").toUpperCase()) {
    case "BASE":
      return "base";
    case "BSC":
      return "bsc";
    case "ETHEREUM":
    case "ETH":
      return "ethereum";
    case "SOLANA":
    case "SOL":
      return "solana";
    default:
      return "unknown";
  }
}
