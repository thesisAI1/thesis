/**
 * Tier B fixture-replay test — X (Twitter) mentions parser.
 *
 * Feeds synthetic JSON through the REAL RealX fetchTweets parser to pin the
 * critical `note_tweet.text` preference logic. If someone changes
 * `t.note_tweet?.text ?? t.text` to `t.text`, the second test below fails —
 * which is exactly the shape drift we want to catch.
 *
 * TODO(tier-b): swap in a real captured payload (record with production keys,
 * save to test/fixtures/x-mentions.json, remove the __synthetic key).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { config } from "../src/config.js";
import { RealX } from "../src/adapters/x/real.js";

const require = createRequire(import.meta.url);
const fixture = require("./fixtures/x-mentions.json") as unknown;

test("RealX.pollMentions: normal tweet uses text field", async () => {
  const realFetch = globalThis.fetch;
  const realBearer = config.x.bearerToken;
  const realUserId = config.x.agentUserId;

  config.x.bearerToken = "test-bearer-token";
  config.x.agentUserId = "test-agent-user-id";

  globalThis.fetch = (async () =>
    new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  try {
    const adapter = new RealX();
    const posts = await adapter.pollMentions();

    const normal = posts.find((p) => p.postId === "tweet-normal-1");
    assert.ok(normal, "normal tweet must be present in output");
    assert.equal(
      normal.text,
      "Short tweet body under 280 chars.",
      "normal tweet must use the text field",
    );
    assert.equal(normal.authorHandle, "@normaluser");
    assert.equal(normal.authorXId, "user-1");
    assert.equal(normal.createdAt, "2024-01-15T10:00:00.000Z");
    assert.equal(normal.engagement, 7, "engagement = likes(5) + retweets(2)");
    assert.equal(normal.authorFollowers, 100);
  } finally {
    globalThis.fetch = realFetch;
    config.x.bearerToken = realBearer;
    config.x.agentUserId = realUserId;
  }
});

test("RealX.pollMentions: long tweet prefers note_tweet.text over truncated text", async () => {
  const realFetch = globalThis.fetch;
  const realBearer = config.x.bearerToken;
  const realUserId = config.x.agentUserId;

  config.x.bearerToken = "test-bearer-token";
  config.x.agentUserId = "test-agent-user-id";

  globalThis.fetch = (async () =>
    new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  try {
    const adapter = new RealX();
    const posts = await adapter.pollMentions();

    const longPost = posts.find((p) => p.postId === "tweet-long-2");
    assert.ok(longPost, "long tweet must be present in output");
    // PIN: the parser must prefer note_tweet.text over the truncated text field.
    assert.match(
      longPost.text,
      /Full long tweet body/,
      "long tweet must use note_tweet.text (not the truncated text field)",
    );
    assert.ok(
      !longPost.text.includes("Truncated text"),
      "truncated text field must NOT appear in the output",
    );
    assert.equal(longPost.authorHandle, "@longpostuser");
    assert.equal(longPost.engagement, 13, "engagement = likes(10) + retweets(3)");
    // PIN: avatar URL is normalized from _normal to _400x400.
    assert.match(
      longPost.authorAvatarUrl ?? "",
      /_400x400\./,
      "avatar URL must be upscaled from _normal to _400x400",
    );
  } finally {
    globalThis.fetch = realFetch;
    config.x.bearerToken = realBearer;
    config.x.agentUserId = realUserId;
  }
});
