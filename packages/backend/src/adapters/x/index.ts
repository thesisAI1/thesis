/**
 * Adapter: X / Twitter API — mention monitoring, timelines, and replies.
 *
 *   - MockX  (./mock.ts)  — fake posts, $0
 *   - RealX  (./real.ts)  — the X API (pay-as-you-go)
 */

import { useMock } from "../../config.js";
import { MockX } from "./mock.js";
import { RealX } from "./real.js";

/** A post fetched from X. */
export interface XPost {
  postId: string;
  authorXId: string;
  authorHandle: string;
  text: string;
  createdAt: string;
  url: string;
  /** The author's follower count — a free Step 1 triage signal. */
  authorFollowers: number;
  /** Likes + reposts on the post — a free triage priority signal. */
  engagement: number;
  /** Id of the tweet this post replies to, or null if it is a top-level post. */
  inReplyToId: string | null;
}

export interface XAdapter {
  /** Poll for new posts that mention the agent. `sinceId` pages forward. */
  pollMentions(sinceId?: string): Promise<XPost[]>;
  /** A user's recent posts — used to extract contract addresses they shared. */
  getUserTimeline(xUserId: string): Promise<XPost[]>;
  /** Reply to a post. Returns the new post's id. */
  replyToPost(postId: string, text: string): Promise<string>;
}

export function createXAdapter(): XAdapter {
  return useMock() ? new MockX() : new RealX();
}
