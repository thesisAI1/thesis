/**
 * Mention-poll cursor persistence (service.ts pollCycle + store get/setMentionCursor).
 *
 * The bug: lastSeenId was an in-memory module global, reset to undefined on every
 * restart — so the first poll after a restart re-scanned only the newest page and
 * (with the one-page 50-cap) silently dropped any backlog beyond it. The fix
 * persists the cursor in the store and resumes from it.
 *
 * isolate-store first → FileStore in a temp dir, mock mode, no network. No
 * ANTHROPIC_API_KEY in mock, so processChatbotReplies returns immediately; the
 * stub mentions carry no contract, so triage drops them silently (no replies).
 */
import "./helpers/isolate-store.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { pollCycle } from "../src/service.js";
import { getStore } from "../src/store/index.js";
import { __setXAdapterForTest, type XAdapter, type XPost } from "../src/adapters/x/index.js";

const mention = (id: string): XPost => ({
  postId: id,
  authorXId: `author-${id}`,
  authorHandle: `@author-${id}`,
  text: "gm fam, no contract address in here", // no CA → triage drops silently
  createdAt: "2026-01-01T00:00:00.000Z",
  url: `https://x.com/i/status/${id}`,
  authorFollowers: 10,
  engagement: 0,
  inReplyToId: null,
});

/** Records the since_id each poll passed; returns scripted batches in order. */
class StubX implements XAdapter {
  sinceIds: Array<string | undefined> = [];
  private i = 0;
  constructor(private readonly batches: XPost[][]) {}
  async pollMentions(sinceId?: string): Promise<XPost[]> {
    this.sinceIds.push(sinceId);
    return this.batches[this.i++] ?? [];
  }
  async getUserTimeline(): Promise<XPost[]> {
    return [];
  }
  async replyToPost(): Promise<string> {
    return "reply-id";
  }
  async replyToPostWithMedia(): Promise<string> {
    return "reply-id";
  }
}

test("pollCycle persists the mention cursor and resumes from it next poll", async () => {
  const store = getStore();
  const stub = new StubX([[mention("100"), mention("200")], []]);
  __setXAdapterForTest(stub);
  try {
    // Cold start — no cursor yet.
    assert.equal(await store.getMentionCursor(), null);

    await pollCycle();

    // Cursor advanced to the newest fetched id AND was persisted.
    assert.equal(await store.getMentionCursor(), "200");
    assert.equal(stub.sinceIds[0], undefined); // first poll: cold start, no since_id

    // Next poll resumes from the PERSISTED cursor (this is what a restart relies
    // on — pollCycle always reads the store, never an in-memory global).
    await pollCycle();
    assert.equal(stub.sinceIds[1], "200");
  } finally {
    __setXAdapterForTest(null);
  }
});

test("pollCycle leaves the cursor untouched when no mentions are returned", async () => {
  const store = getStore();
  await store.setMentionCursor("500");
  const stub = new StubX([[]]); // empty poll
  __setXAdapterForTest(stub);
  try {
    await pollCycle();
    assert.equal(await store.getMentionCursor(), "500"); // unchanged
    assert.equal(stub.sinceIds[0], "500"); // resumed from the persisted cursor
  } finally {
    __setXAdapterForTest(null);
  }
});

test("setMentionCursor round-trips and defaults to null", async () => {
  const store = getStore();
  await store.setMentionCursor("abc123");
  assert.equal(await store.getMentionCursor(), "abc123");
});

test("pollCycle does NOT advance the cursor when the mention fetch fails", async () => {
  // A fetch error must early-return and leave the cursor where it was, so the
  // next poll re-fetches the same window — nothing is skipped past a blip.
  const store = getStore();
  await store.setMentionCursor("700");
  const throwing: XAdapter = {
    async pollMentions() {
      throw new Error("network blip");
    },
    async getUserTimeline() {
      return [];
    },
    async replyToPost() {
      return "r";
    },
    async replyToPostWithMedia() {
      return "r";
    },
  };
  __setXAdapterForTest(throwing);
  try {
    await pollCycle(); // must not throw
    assert.equal(await store.getMentionCursor(), "700"); // unchanged
  } finally {
    __setXAdapterForTest(null);
  }
});
