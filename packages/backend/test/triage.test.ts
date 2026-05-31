/**
 * Tier A — Step-1 triage filters (triage/index.ts).
 *
 * The front door: free, instant filters that decide which mentions become
 * review submissions. A regression here silently drops real theses or lets junk
 * (or duplicates) through to the expensive LLM path. These pin each filter:
 *   - no contract address      → silently dropped (chatbot territory)
 *   - author below follower floor → silently dropped
 *   - thesis too short          → rejected (thesis_too_short)
 *   - same contract again       → rejected (contract_dedup)
 *   - same author again         → rejected (author_cooldown)
 *   - already processed         → skipped
 *   - valid                     → eligible, with contract extracted + priority
 *
 * Characterization guards (GREEN on arrival) — they fail if a filter's
 * behavior changes. Thresholds are pinned via config so env overrides can't
 * make the suite flaky; ids are unique per test because the file store is a
 * process-wide singleton and markProcessed persists across the suite.
 */

import "./helpers/isolate-store.js"; // temp DATA_DIR + mock mode before config loads
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { triageMentions } from "../src/triage/index.js";
import type { XPost } from "../src/adapters/x/index.js";

const A = "0x1111111111111111111111111111111111110001";
const GOOD_THESIS = "strong real fundamentals and a growing engaged community here";

/** Pin triage thresholds for deterministic assertions; restore afterwards so
 *  the mutation doesn't leak into other suite files (same process). */
async function withTriage(fn: () => Promise<void>): Promise<void> {
  const t = config.triage as {
    minAuthorFollowers: number;
    minThesisWords: number;
    authorCooldownHours: number;
    contractDedupHours: number;
    selfBlacklist: string[];
  };
  const prev = { ...t };
  t.minAuthorFollowers = 50;
  t.minThesisWords = 6;
  t.authorCooldownHours = 3;
  t.contractDedupHours = 6;
  t.selfBlacklist = [];
  try {
    await fn();
  } finally {
    Object.assign(t, prev);
  }
}

function mention(opts: {
  postId: string;
  authorXId: string;
  text: string;
  followers?: number;
  engagement?: number;
}): XPost {
  return {
    postId: opts.postId,
    authorXId: opts.authorXId,
    authorHandle: "@author",
    text: opts.text,
    createdAt: new Date().toISOString(),
    url: `https://x.com/x/status/${opts.postId}`,
    authorFollowers: opts.followers ?? 500,
    engagement: opts.engagement ?? 0,
    inReplyToId: null,
  };
}

test("triage: a mention with no contract is silently dropped (not eligible, not rejected)", async () => {
  await withTriage(async () => {
    const res = await triageMentions([
      mention({ postId: "tr-nocontract", authorXId: "u-nocontract", text: "what do you all think of the market today" }),
    ]);
    assert.equal(res.eligible.length, 0, "no contract → no submission");
    assert.equal(res.rejected.length, 0, "no contract is silent (chatbot territory), not a rejection");
  });
});

test("triage: an author below the follower floor is silently dropped", async () => {
  await withTriage(async () => {
    const res = await triageMentions([
      mention({ postId: "tr-lowfoll", authorXId: "u-lowfoll", text: `${A} ${GOOD_THESIS}`, followers: 10 }),
    ]);
    assert.equal(res.eligible.length, 0, "below follower floor → dropped");
    assert.equal(res.rejected.length, 0, "follower-floor drops are intentionally silent");
  });
});

test("triage: a too-short thesis is rejected (thesis_too_short)", async () => {
  await withTriage(async () => {
    const res = await triageMentions([
      mention({ postId: "tr-short", authorXId: "u-short", text: `${A} buy` }),
    ]);
    assert.equal(res.eligible.length, 0);
    assert.equal(res.rejected.length, 1);
    assert.equal(res.rejected[0]?.reason.kind, "thesis_too_short");
  });
});

test("triage: a valid thesis becomes an eligible QueueItem with the contract extracted", async () => {
  await withTriage(async () => {
    const res = await triageMentions([
      mention({ postId: "tr-valid", authorXId: "u-valid", text: `${A} ${GOOD_THESIS}`, followers: 500, engagement: 3 }),
    ]);
    assert.equal(res.eligible.length, 1);
    assert.equal(res.eligible[0]?.submission.contractAddress, A);
    // priority = followers + engagement*8
    assert.equal(res.eligible[0]?.priority, 500 + 3 * 8);
    assert.equal(res.passed, 1);
    assert.equal(res.seen, 1);
  });
});

test("triage: the same contract twice in a batch → second is rejected (contract_dedup)", async () => {
  await withTriage(async () => {
    const contract = "0x2222222222222222222222222222222222220002";
    const res = await triageMentions([
      mention({ postId: "tr-dup-1", authorXId: "u-dup-1", text: `${contract} ${GOOD_THESIS}` }),
      mention({ postId: "tr-dup-2", authorXId: "u-dup-2", text: `${contract} ${GOOD_THESIS}` }),
    ]);
    assert.equal(res.eligible.length, 1, "only the first submission for a contract is eligible");
    assert.equal(res.rejected.length, 1);
    assert.equal(res.rejected[0]?.reason.kind, "contract_dedup");
  });
});

test("triage: the same author twice in a batch → second is rejected (author_cooldown)", async () => {
  await withTriage(async () => {
    const res = await triageMentions([
      mention({ postId: "tr-auth-1", authorXId: "u-cooldown", text: `0x3333333333333333333333333333333333330003 ${GOOD_THESIS}` }),
      mention({ postId: "tr-auth-2", authorXId: "u-cooldown", text: `0x4444444444444444444444444444444444440004 ${GOOD_THESIS}` }),
    ]);
    assert.equal(res.eligible.length, 1, "only one submission per author per cooldown window");
    assert.equal(res.rejected.length, 1);
    assert.equal(res.rejected[0]?.reason.kind, "author_cooldown");
  });
});

test("triage: an already-processed post is skipped", async () => {
  await withTriage(async () => {
    const res1 = await triageMentions([
      mention({ postId: "tr-once", authorXId: "u-once", text: `0x5555555555555555555555555555555555550005 ${GOOD_THESIS}` }),
    ]);
    assert.equal(res1.eligible.length, 1, "first pass: eligible");
    // Re-feed the SAME postId — markProcessed from the first pass must skip it.
    const res2 = await triageMentions([
      mention({ postId: "tr-once", authorXId: "u-once", text: `0x5555555555555555555555555555555555550005 ${GOOD_THESIS}` }),
    ]);
    assert.equal(res2.eligible.length, 0, "a processed post must not be re-queued");
    assert.equal(res2.rejected.length, 0);
  });
});
