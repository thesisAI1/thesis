import { getStore } from "../../store/index.js";
import { seed } from "../../util/seed.js";
import type { XAdapter, XPost } from "./index.js";

/**
 * Fake X data — generates a small batch of varied submissions on every poll
 * (simulating real mention volume), each with follower and engagement
 * numbers, so the triage funnel and the live Faculty Room stay active.
 *
 * It also simulates the author payout loop: whenever the Endowment has posted
 * a "reply with your wallet" request, the mock makes the original author
 * answer it with a wallet address on the next poll — plus, once, an imposter
 * reply from a different account, to exercise the anti-hijack check.
 */
const HANDLES = [
  "@degen_scholar",
  "@base_maxi",
  "@onchain_owl",
  "@alpha_seeker",
  "@meme_thesis",
  "@liquidity_lord",
  "@chart_whisperer",
  "@the_quant",
];

const THESES = [
  "real community forming, devs active, liquidity locked.",
  "clean holder spread, no whales, organic chart — still early.",
  "this is the Base meta play this cycle, strong narrative.",
  "stealth launch, tiny mcap, room to run. backed by a real team.",
  "known team, verified contract, actual utility behind it.",
  "volume picking up fast and the chart looks ready to send.",
];

let counter = 0;
let replyCounter = 0;
/** Payout-request tweet ids this mock has already answered. */
const answeredRequests = new Set<string>();
/** The mock emits a single imposter wallet reply, once, ever. */
let imposterEmitted = false;

/** Build a deterministic, distinct, address-shaped 40-hex contract. */
function mockAddress(n: number): string {
  const hex = "0123456789abcdef";
  // 32-bit integer maths only (Math.imul) — no float precision loss.
  let x = (Math.imul(n + 1, 2_654_435_761) ^ 0x9e3779b9) >>> 0;
  let addr = "0x";
  for (let i = 0; i < 40; i++) {
    x = (Math.imul(x, 1_664_525) + 1_013_904_223) >>> 0;
    addr += hex[(x >>> 24) & 15];
  }
  return addr;
}

/** A deterministic 0x wallet for a mock author — stable per X id. */
function mockWallet(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return mockAddress(h);
}

export class MockX implements XAdapter {
  async pollMentions(): Promise<XPost[]> {
    const batch: XPost[] = [];

    // Simulate authors answering open payout requests with a wallet address.
    for (const req of await getStore().getPayoutRequests()) {
      if (answeredRequests.has(req.requestTweetId)) continue;
      answeredRequests.add(req.requestTweetId);

      // Once: an imposter replies to the request from a different account.
      // The payout handler must reject it — only the original author pays out.
      if (!imposterEmitted) {
        imposterEmitted = true;
        counter += 1;
        batch.push({
          postId: `mock-imposter-${Date.now()}-${counter}`,
          authorXId: "mock-imposter-9999",
          authorHandle: "@wallet_thief",
          text: `@thesis pay me here ${mockWallet("imposter")} thanks`,
          createdAt: new Date().toISOString(),
          url: `https://x.com/wallet_thief/status/${counter}`,
          authorFollowers: 12,
          engagement: 0,
          inReplyToId: req.requestTweetId,
        });
      }

      counter += 1;
      batch.push({
        postId: `mock-walletreply-${Date.now()}-${counter}`,
        authorXId: req.xUserId, // the ORIGINAL author answers
        authorHandle: req.handle,
        text: `@thesis here's my payout wallet — ${mockWallet(req.xUserId)} — thanks committee!`,
        createdAt: new Date().toISOString(),
        url: `https://x.com/${req.handle.slice(1)}/status/reply-${counter}`,
        authorFollowers: 100,
        engagement: 0,
        inReplyToId: req.requestTweetId,
      });
    }

    // The usual batch of fresh thesis submissions.
    for (let i = 0; i < 3; i++) {
      counter += 1;
      const id = `mock-${counter}`;
      const handle = HANDLES[counter % HANDLES.length];
      const thesis = THESES[counter % THESES.length];
      const ca = mockAddress(counter);
      batch.push({
        postId: `mock-post-${Date.now()}-${counter}`,
        authorXId: id,
        authorHandle: handle,
        text: `@thesis ${thesis} CA: ${ca}`,
        createdAt: new Date().toISOString(),
        url: `https://x.com/${handle.slice(1)}/status/${counter}`,
        authorFollowers: 40 + Math.floor(seed(id, "followers") * 5000),
        engagement: Math.floor(seed(id, "engagement") * 600),
        inReplyToId: null,
      });
    }
    return batch;
  }

  async getUserTimeline(): Promise<XPost[]> {
    return [];
  }

  async replyToPost(_postId: string, _text: string): Promise<string> {
    replyCounter += 1;
    return `mock-reply-${Date.now()}-${replyCounter}`;
  }

  async replyToPostWithMedia(
    _postId: string,
    _text: string,
    _media: Buffer,
  ): Promise<string> {
    // Mock doesn't actually post — same behaviour as text reply, media ignored.
    replyCounter += 1;
    return `mock-reply-${Date.now()}-${replyCounter}`;
  }
}
