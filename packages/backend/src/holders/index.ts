/**
 * Holder lottery — pick 5 random $THESIS holders to receive the team cut.
 *
 * Each winning trade no longer pays a fixed "team wallet" — instead the 25%
 * team slice splits into 5 equal 5% transfers to randomly-picked eligible
 * $THESIS holders. Eligible means:
 *   - balance >= HOLDER_LOTTERY_MIN_TOKENS (default 10M $THESIS)
 *   - NOT a liquidity-pool contract (auto-detected from DexScreener pairs)
 *   - NOT the burn address, trading wallet, team wallet, or any address on
 *     HOLDER_LOTTERY_EXTRA_EXCLUDES (env var, comma-separated)
 *
 * Holder enumeration uses GoldRush (Covalent) since Birdeye's holder endpoint
 * is Solana-only. GoldRush returns the top holders sorted by balance with the
 * raw on-chain amount in a single call — perfect for our use case. Free tier
 * (25k credits) covers the hourly snapshot at our scale.
 *
 * Selection is uniform random across eligibles (10M holder and 1B holder
 * have equal odds) seeded by the close transaction hash so the pick is
 * verifiable on-chain — anyone can re-run the same modulo math against
 * the published holder snapshot + tx hash and confirm we picked correctly.
 *
 * If we ever drop below 5 eligibles (catastrophic dump scenario), we pay
 * whatever we have and the remainder is folded into the buyback budget for
 * that close — never lost.
 */

import { keccak256, toBytes } from "viem";
import { config } from "../config.js";
import { log } from "../util/log.js";

/** A wallet that's eligible for the lottery, with its current raw token
 *  balance (as bigint to preserve precision across 18-decimal math). */
export interface EligibleHolder {
  address: string;
  balance: bigint;
}

/** Result of a lottery draw — winners chosen + how many eligibles were
 *  in the pool at draw time (for tweet copy + transparency). */
export interface LotteryDraw {
  winners: string[];
  eligibleCount: number;
}

/** GoldRush (Covalent) `/v1/{chainName}/tokens/{address}/token_holders_v2/`
 *  response shape (the subset we care about). Items are returned sorted by
 *  balance DESC with raw on-chain amounts as strings. */
interface GoldRushHolderResp {
  data?: {
    items?: Array<{
      address?: string;
      balance?: string;
      contract_decimals?: number;
      block_height?: number;
    }>;
    pagination?: {
      has_more?: boolean;
      page_number?: number;
      page_size?: number;
    };
  };
  error?: boolean;
  error_message?: string | null;
}

/** DexScreener token endpoint — we use it to find every LP pair address for
 *  the $THESIS token so the lottery skips them automatically. */
interface DexScreenerToken {
  pairs?: Array<{ pairAddress?: string }>;
}

/** GoldRush base URL. Path: `/v1/base-mainnet/tokens/{addr}/token_holders_v2/`.
 *  Auth via Basic header: `Authorization: Basic <base64(apiKey + ":")>`. */
const GOLDRUSH_API = "https://api.covalenthq.com/v1";
const GOLDRUSH_CHAIN = "base-mainnet";
const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens";
const ETHERSCAN_V2 = "https://api.etherscan.io/v2/api";

/** Known Clanker token-factory contracts on Base (v0-v4). Mirrors the list
 *  in basedata/real.ts. Excluded from the lottery because if a token has
 *  been launched via Clanker the factory itself may show up in the holder
 *  list as a transient artefact of deployment. Defensive — even if our
 *  $THESIS token wasn't Clanker-launched, including these costs nothing
 *  and protects against future tokens that might be. */
const CLANKER_FACTORIES = [
  "0xe85a59c628f7d27878aceb4bf3b35733630083a9", // v4
  "0x2a787b2362021cc3eea3c24c4748a6cd5b687382", // v3.1
  "0x375c15db32d28cecdcab5c03ab889bf15cbd2c5e", // v3.0
  "0x732560fa1d1a76350b1a500155ba978031b53833", // v2
  "0x9b84fce5dcd9a38d2d01d5d72373f6b6b067c3e1", // v1
  "0x250c9fb2b411b48273f69879007803790a6aea47", // v0 (SocialDexDeployer)
];

/** The zero address. Some tokens / migrations burn here instead of 0x...dEaD;
 *  either way, paying it does nothing useful. */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Module-lifetime cache of the holder snapshot. Refetched only when the
 *  TTL expires, since Birdeye's holder endpoint is on a tighter rate limit
 *  than the price endpoints we hit constantly. */
let _snapshotCache: EligibleHolder[] = [];
let _snapshotFetchedAt = 0;
/** Module-lifetime cache of LP / pool addresses to exclude. Same TTL story. */
let _excludesCache: Set<string> = new Set();
let _excludesFetchedAt = 0;

/**
 * Fetch the current list of eligible holders. Returns a cached snapshot
 * unless the TTL has elapsed. On failure to refresh, the previous snapshot
 * is reused so a transient Birdeye outage doesn't disable the lottery.
 */
export async function getEligibleHolders(): Promise<EligibleHolder[]> {
  const ttlMs = config.holderLottery.snapshotTtlMin * 60 * 1000;
  if (_snapshotCache.length > 0 && Date.now() - _snapshotFetchedAt < ttlMs) {
    return _snapshotCache;
  }
  try {
    const fresh = await fetchHoldersSnapshot();
    if (fresh.length > 0) {
      _snapshotCache = fresh;
      _snapshotFetchedAt = Date.now();
    }
  } catch (err) {
    log.warn(
      `holders: snapshot refresh failed (${String(err)}) — reusing previous (${_snapshotCache.length} eligibles)`,
    );
  }
  return _snapshotCache;
}

/**
 * Build the exclusion set — everything a lottery payout should NEVER land on.
 * Cached for the same TTL as the holder snapshot (60 min default) so we don't
 * re-hit the explorer/DexScreener every settlement.
 *
 * Layered defence:
 *   1. Universal "dead" addresses — burn, zero address.
 *   2. Project addresses — team wallet, the $THESIS contract itself (a
 *      token contract holding its own supply does nothing useful with ETH),
 *      and operator-provided extras from HOLDER_LOTTERY_EXTRA_EXCLUDES.
 *   3. Launchpad infrastructure — every known Clanker factory address (v0-v4)
 *      plus the dynamic deployer of the $THESIS contract itself (resolved
 *      via BaseScan). This auto-catches Bankr's launchpad contract, any
 *      other launchpad, OR the actual creator wallet if one of those — none
 *      of which represents a "holder" in the spirit of the lottery.
 *   4. Liquidity pools — every pair address DexScreener knows about for
 *      $THESIS. Auto-discovered every refresh, so newly-added pools get
 *      excluded next snapshot without code changes.
 */
async function getExcludeSet(): Promise<Set<string>> {
  const ttlMs = config.holderLottery.snapshotTtlMin * 60 * 1000;
  if (_excludesCache.size > 0 && Date.now() - _excludesFetchedAt < ttlMs) {
    return _excludesCache;
  }
  const set = new Set<string>();
  // (1) Universal dead addresses.
  set.add(config.chain.burnAddress.toLowerCase());
  set.add(ZERO_ADDRESS);
  // (2) Project + operator-controlled addresses.
  if (config.chain.teamWallet) set.add(config.chain.teamWallet.toLowerCase());
  if (config.chain.thesisToken) set.add(config.chain.thesisToken.toLowerCase());
  for (const a of config.holderLottery.extraExcludes) set.add(a);
  // Note: trading wallet is resolved at runtime by the Endowment and passed
  // through drawLottery() as extraExcludeAddress.
  // (3) Launchpad infrastructure — Clanker factories (defensive) + the
  // dynamic deployer of $THESIS (catches Bankr / whatever launchpad was used).
  for (const f of CLANKER_FACTORIES) set.add(f);
  try {
    const deployer = await fetchTokenDeployer(config.chain.thesisToken);
    if (deployer) {
      set.add(deployer.toLowerCase());
      log.info(`holders: auto-excluded $THESIS deployer ${deployer} (launchpad / creator)`);
    }
  } catch (err) {
    log.warn(`holders: deployer lookup failed (${String(err)}) — launchpad address may still appear in pool`);
  }
  // (4) Liquidity pools — auto-detected from DexScreener.
  try {
    const pairs = await fetchDexScreenerPairs(config.chain.thesisToken);
    for (const p of pairs) set.add(p);
    log.info(`holders: LP exclude list — ${pairs.length} pair address(es) from DexScreener`);
  } catch (err) {
    log.warn(`holders: DexScreener pair lookup failed (${String(err)}) — LP exclusion may be incomplete`);
  }
  _excludesCache = set;
  _excludesFetchedAt = Date.now();
  log.info(`holders: exclude set rebuilt — ${set.size} addresses blacklisted`);
  return set;
}

/** Fetch the creator (deployer) of a contract via BaseScan / Etherscan v2.
 *  For a Bankr-launched $THESIS this returns Bankr's launchpad contract; for
 *  a Clanker-launched token, the Clanker factory; etc. Returns null if the
 *  API key isn't configured or the call fails — caller treats as "no extra
 *  exclude" and continues. */
async function fetchTokenDeployer(address: string): Promise<string | null> {
  if (!address || !config.auditor.basescanApiKey) return null;
  const url =
    `${ETHERSCAN_V2}?chainid=8453&module=contract&action=getcontractcreation` +
    `&contractaddresses=${address}&apikey=${config.auditor.basescanApiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    result?: Array<{ contractCreator?: string }>;
  };
  return json.result?.[0]?.contractCreator ?? null;
}

/** Build the snapshot from scratch: GoldRush holders → exclude LPs etc. →
 *  filter by min balance. Returns a fresh array sorted by balance DESC. */
async function fetchHoldersSnapshot(): Promise<EligibleHolder[]> {
  if (!config.chain.thesisToken) {
    log.warn("holders: THESIS_TOKEN_ADDRESS not set — lottery has no token to snapshot");
    return [];
  }
  if (!config.baseData.goldRushKey) {
    log.warn("holders: GOLDRUSH_API_KEY not set — lottery cannot fetch holder list");
    return [];
  }
  const raw = await fetchGoldRushHolders(config.chain.thesisToken);
  const excludes = await getExcludeSet();
  // 10M default → 10_000_000 * 10^18 wei (assumes 18-decimal ERC20, the
  // Clanker default). If GoldRush reports a different `contract_decimals`
  // for the holder we honour it.
  const minTokens = BigInt(config.holderLottery.minHoldingTokens);
  const eligibles: EligibleHolder[] = [];
  for (const h of raw) {
    if (!h.address) continue;
    const addr = h.address.toLowerCase();
    if (excludes.has(addr)) continue;
    const decimals = h.contract_decimals ?? 18;
    const balanceRaw = h.balance ? BigInt(h.balance) : 0n;
    if (balanceRaw === 0n) continue;
    const minRaw = minTokens * 10n ** BigInt(decimals);
    if (balanceRaw < minRaw) continue;
    eligibles.push({ address: addr, balance: balanceRaw });
  }
  eligibles.sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0));
  log.info(`holders: snapshot refreshed — ${eligibles.length} eligible (>=${config.holderLottery.minHoldingTokens.toLocaleString()} $THESIS)`);
  return eligibles;
}

/** Hit GoldRush's token_holders_v2 endpoint on Base. Returns the raw items
 *  array; the caller filters + sorts. GoldRush returns holders pre-sorted
 *  by balance DESC and supports pagination up to ~10k holders. We pull two
 *  pages (top 200) since the lottery never needs more than that. */
async function fetchGoldRushHolders(
  tokenAddress: string,
): Promise<NonNullable<NonNullable<GoldRushHolderResp["data"]>["items"]>> {
  const items: NonNullable<NonNullable<GoldRushHolderResp["data"]>["items"]> = [];
  // GoldRush auth is HTTP Basic with the API key as the username (empty pwd).
  // Encoding done once at fetch time so the key isn't sitting around base64'd
  // in module state.
  const authHeader = "Basic " + Buffer.from(`${config.baseData.goldRushKey}:`).toString("base64");
  for (let page = 0; page < 2; page++) {
    const url = `${GOLDRUSH_API}/${GOLDRUSH_CHAIN}/tokens/${tokenAddress}/token_holders_v2/?page-size=100&page-number=${page}`;
    const res = await fetch(url, {
      headers: { authorization: authHeader, accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`GoldRush holders ${res.status}: ${await res.text().catch(() => "")}`);
    }
    const json = (await res.json()) as GoldRushHolderResp;
    if (json.error) {
      throw new Error(`GoldRush error: ${json.error_message ?? "unknown"}`);
    }
    const pageItems = json.data?.items ?? [];
    items.push(...pageItems);
    // Stop early if the page came back short (no more pages) or pagination
    // metadata explicitly says we're done.
    if (pageItems.length < 100 || json.data?.pagination?.has_more === false) break;
  }
  return items;
}

/** Pull every LP pair address DexScreener knows about for the token.
 *  Returns lowercased addresses suitable for the exclusion Set. */
async function fetchDexScreenerPairs(tokenAddress: string): Promise<string[]> {
  const res = await fetch(`${DEXSCREENER_API}/${tokenAddress}`);
  if (!res.ok) throw new Error(`DexScreener ${res.status}`);
  const json = (await res.json()) as DexScreenerToken;
  return (json.pairs ?? [])
    .map((p) => (p.pairAddress ?? "").toLowerCase())
    .filter((a) => a.length > 0);
}

/**
 * Pick `count` unique winners uniformly at random from the eligibles array,
 * seeded by the close transaction hash so the result is verifiable. Anyone
 * can re-run the same modulo math against the published snapshot + tx hash
 * and confirm we picked exactly the addresses we paid out.
 *
 * Algorithm: chain keccak256 over (txHash || index) for each draw, take the
 * result mod (remaining pool size), pull that index out, repeat. Standard
 * Fisher-Yates style but with a deterministic PRF instead of Math.random.
 */
export function pickLotteryWinners(
  eligibles: EligibleHolder[],
  count: number,
  seedTxHash: string,
): LotteryDraw {
  const pool = eligibles.slice();
  const winners: string[] = [];
  const desired = Math.min(count, pool.length);
  const seedBytes = toBytes(seedTxHash as `0x${string}`);
  for (let i = 0; i < desired; i++) {
    // Hash (seedBytes || i) to get a fresh 32-byte uniform value for round i.
    const idxBytes = new Uint8Array(seedBytes.length + 32);
    idxBytes.set(seedBytes, 0);
    // Encode the round counter as a 32-byte big-endian uint.
    const counter = new Uint8Array(32);
    new DataView(counter.buffer).setUint32(28, i, false);
    idxBytes.set(counter, seedBytes.length);
    const digest = keccak256(idxBytes);
    // Take the last 16 hex chars (64 bits) as a JS bigint — easily fits a
    // sane modulo even for very large pools.
    const word = BigInt("0x" + digest.slice(-16));
    const idx = Number(word % BigInt(pool.length));
    winners.push(pool[idx].address);
    // Remove the picked holder so subsequent rounds can't pick them again.
    pool.splice(idx, 1);
  }
  return { winners, eligibleCount: eligibles.length };
}

/** Convenience: snapshot + pick in one call. Used by the Endowment when
 *  it's time to settle. */
export async function drawLottery(
  count: number,
  seedTxHash: string,
  extraExcludeAddress?: string,
): Promise<LotteryDraw> {
  const all = await getEligibleHolders();
  // Optional extra exclude — used to drop our own trading wallet, which is
  // resolved at runtime from the chain adapter (not known at config time).
  const eligibles = extraExcludeAddress
    ? all.filter((h) => h.address !== extraExcludeAddress.toLowerCase())
    : all;
  return pickLotteryWinners(eligibles, count, seedTxHash);
}
