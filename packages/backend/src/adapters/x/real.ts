import { config } from "../../config.js";
import { oauth1Header } from "../../util/oauth1.js";
import type { XAdapter, XPost } from "./index.js";

const API = "https://api.twitter.com/2";

/**
 * Real X API v2 client.
 *
 * Reading (mentions, timelines) uses the app-only bearer token. Posting
 * replies requires user context — OAuth 1.0a with the agent account's
 * pre-generated access tokens. Watch the rate limits as closely as the
 * dollar spend; throughput is the real constraint on pay-as-you-go.
 */
export class RealX implements XAdapter {
  async pollMentions(sinceId?: string): Promise<XPost[]> {
    if (!config.x.agentUserId) {
      throw new Error("X_AGENT_USER_ID is required to poll mentions.");
    }
    const params = baseParams();
    if (sinceId) params.set("since_id", sinceId);
    return this.fetchTweets(`${API}/users/${config.x.agentUserId}/mentions?${params}`);
  }

  async getUserTimeline(xUserId: string): Promise<XPost[]> {
    const params = baseParams();
    params.set("max_results", "100");
    return this.fetchTweets(`${API}/users/${xUserId}/tweets?${params}`);
  }

  async replyToPost(postId: string, text: string): Promise<string> {
    if (!config.x.apiKey || !config.x.accessToken) {
      throw new Error("X OAuth 1.0a credentials (X_API_KEY etc.) are required to post replies.");
    }
    const url = `${API}/tweets`;
    const auth = oauth1Header("POST", url, {
      apiKey: config.x.apiKey,
      apiSecret: config.x.apiSecret,
      accessToken: config.x.accessToken,
      accessSecret: config.x.accessSecret,
    });
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: postId } }),
    });
    if (!res.ok) throw new Error(`X reply ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data?: { id?: string } };
    return json.data?.id ?? "";
  }

  private async fetchTweets(url: string): Promise<XPost[]> {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.x.bearerToken}` },
    });
    if (!res.ok) throw new Error(`X API ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as XApiResponse;
    const users = new Map((json.includes?.users ?? []).map((u) => [u.id, u]));
    return (json.data ?? []).map((t) => {
      const user = users.get(t.author_id);
      const metrics = t.public_metrics;
      const repliedTo = (t.referenced_tweets ?? []).find((r) => r.type === "replied_to");
      // X Premium long tweets (>280 chars) put the full body in `note_tweet.text`;
      // the regular `text` field is truncated with an ellipsis at the 280-char
      // boundary. Reading just `text` loses any CA placed at the end of a long
      // thesis, which silently drops the submission in triage.
      const fullText = t.note_tweet?.text ?? t.text;
      return {
        postId: t.id,
        authorXId: t.author_id,
        authorHandle: "@" + (user?.username ?? "unknown"),
        text: fullText,
        createdAt: t.created_at ?? new Date().toISOString(),
        url: `https://x.com/i/status/${t.id}`,
        authorFollowers: user?.public_metrics?.followers_count ?? 0,
        engagement: (metrics?.like_count ?? 0) + (metrics?.retweet_count ?? 0),
        inReplyToId: repliedTo?.id ?? null,
      };
    });
  }
}

function baseParams(): URLSearchParams {
  return new URLSearchParams({
    "tweet.fields": "created_at,author_id,public_metrics,referenced_tweets,note_tweet",
    expansions: "author_id",
    "user.fields": "username,public_metrics",
    max_results: "50",
  });
}

interface XUser {
  id: string;
  username: string;
  public_metrics?: { followers_count?: number };
}

interface XTweet {
  id: string;
  text: string;
  /** Full body for X Premium long tweets — preferred over `text` when present. */
  note_tweet?: { text?: string };
  author_id: string;
  created_at?: string;
  public_metrics?: { like_count?: number; retweet_count?: number };
  referenced_tweets?: { type: string; id: string }[];
}

interface XApiResponse {
  data?: XTweet[];
  includes?: { users?: XUser[] };
}
