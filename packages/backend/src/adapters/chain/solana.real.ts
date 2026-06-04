import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionExpiredBlockheightExceededError,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";
import { config } from "../../config.js";
import { log, logEvent } from "../../util/log.js";
import { toBaseUnits } from "../../util/units.js";
import type { ChainAdapter, SwapResult } from "./index.js";
import {
  parseJupiterQuote,
  parseJupiterSwap,
  type JupiterQuote,
  type JupiterSwap,
} from "./jupiter-parse.js";
import { fetchTipFloor, submitJitoBundle, tipForAttempt } from "./jito.js";

/**
 * Real Solana client — the RealChain analogue. Swaps route through the Jupiter
 * v6 Aggregator (the Solana equivalent of KyberSwap): GET /quote → POST /swap
 * returns a base64 VersionedTransaction we sign with our keypair and submit.
 *
 * Native unit is SOL, so the `*Eth` fields carry SOL. WSOL is the quote asset
 * (Jupiter wraps/unwraps automatically). Balance + price reads work with just an
 * RPC; spending — buy, sell, sendEth — is GATED behind LIVE_TRADING_ARMED, the
 * SAME global arm switch the Base chain uses.
 *
 * MEV protection (sandwich defence): swaps go out as PRIVATE Jito bundles with a
 * tight dynamic slippage and an escalating tip (see jito.ts). A swap that will
 * not land is retried at a higher tip — never broadcast on the public RPC — and
 * abandoned (with an alarm) if the tip cap is hit. SOLANA_JITO_ENABLED=false
 * reverts to the legacy unprotected public path (testing only).
 *
 * SCAFFOLDED: written to be correct and typecheck-clean; live verification
 * happens once the Solana trading wallet is funded. The keypair is decoded
 * lazily so merely selecting this adapter (e.g. for a stray Solana submission on
 * a Base-only deployment) never throws — only an actual trade/read does.
 */
export class RealSolanaChain implements ChainAdapter {
  /** Wrapped-SOL mint (Jupiter's quote asset), from config. */
  private readonly wsol = config.solana.wsolMint;

  private readonly connection = new Connection(config.solana.rpcUrl, "confirmed");
  private _kp: Keypair | null = null;
  private readonly decimalsCache = new Map<string, number>();

  /** Lazily decode the base58 secret key. Throws a clear error if unset. */
  private keypair(): Keypair {
    if (this._kp) return this._kp;
    const key = config.solana.tradingWalletKey;
    if (!key) {
      throw new Error(
        "SOLANA_TRADING_WALLET_KEY is not set — cannot sign Solana trades.",
      );
    }
    this._kp = Keypair.fromSecretKey(bs58.decode(key));
    return this._kp;
  }

  private ensureArmed(): void {
    if (!config.chain.liveTradingArmed) {
      throw new Error("LIVE_TRADING_ARMED is not 'true' — refusing real Solana swap.");
    }
  }

  getWalletAddress(): string {
    return this.keypair().publicKey.toBase58();
  }

  async getWalletBalanceEth(): Promise<number> {
    const lamports = await this.connection.getBalance(this.keypair().publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }

  /** Mint decimals, cached (immutable per mint). Resolves the owning token
   *  program from the account itself so BOTH legacy SPL and Token-2022 mints
   *  work: getMint defaults to the legacy program and throws
   *  TokenInvalidAccountOwnerError on a Token-2022 mint (a graduated token can
   *  be either), which previously failed the whole buy/sell. */
  private async decimals(mint: string): Promise<number> {
    const hit = this.decimalsCache.get(mint);
    if (hit !== undefined) return hit;
    const mintPk = new PublicKey(mint);
    const account = await this.connection.getAccountInfo(mintPk);
    if (!account) throw new Error(`solana: mint ${mint} not found on-chain`);
    const programId = account.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;
    const info = await getMint(this.connection, mintPk, "confirmed", programId);
    this.decimalsCache.set(mint, info.decimals);
    return info.decimals;
  }

  /** SOL per whole token, from a live Jupiter quote selling 1 token. */
  async getTokenPriceEth(mint: string): Promise<number> {
    const dec = await this.decimals(mint);
    const oneToken = BigInt(10) ** BigInt(dec);
    const quote = await this.getQuote(mint, this.wsol, oneToken.toString());
    return Number(quote.outAmount) / LAMPORTS_PER_SOL;
  }

  async buy(mint: string, amountInEth: number): Promise<SwapResult> {
    this.ensureArmed();
    const lamportsIn = BigInt(Math.round(amountInEth * LAMPORTS_PER_SOL));
    const dec = await this.decimals(mint);
    // protectedSwap re-quotes per attempt; book PnL off the quote that landed.
    const { txHash, outAmount } = await this.protectedSwap(
      this.wsol,
      mint,
      lamportsIn.toString(),
    );
    const amountOut = Number(outAmount) / 10 ** dec;
    const priceEth = amountOut > 0 ? amountInEth / amountOut : 0;
    log.info(`solana: buy via Jupiter — ${amountInEth} SOL → ${amountOut} of ${mint} — tx ${txHash}`);
    return { txHash, amountOut, priceEth };
  }

  async sell(
    mint: string,
    amountTokens: number,
    _opts?: { maxAttempts?: number; delayBetweenMs?: number },
  ): Promise<SwapResult> {
    this.ensureArmed();
    const dec = await this.decimals(mint);
    const baseUnits = toBaseUnits(amountTokens, dec);
    if (baseUnits <= 0n) throw new Error(`solana: cannot sell — 0 base units of ${mint}`);
    const { txHash, outAmount } = await this.protectedSwap(
      mint,
      this.wsol,
      baseUnits.toString(),
    );
    const proceedsEth = Number(outAmount) / LAMPORTS_PER_SOL;
    const priceEth = amountTokens > 0 ? proceedsEth / amountTokens : 0;
    log.info(`solana: sell via Jupiter — ${amountTokens} of ${mint} → ${proceedsEth} SOL — tx ${txHash}`);
    return { txHash, amountOut: proceedsEth, priceEth };
  }

  async quoteSell(mint: string, amountTokens: number): Promise<{ proceedsEth: number }> {
    const dec = await this.decimals(mint);
    const baseUnits = toBaseUnits(amountTokens, dec);
    if (baseUnits <= 0n) return { proceedsEth: 0 };
    const quote = await this.getQuote(mint, this.wsol, baseUnits.toString());
    return { proceedsEth: Number(quote.outAmount) / LAMPORTS_PER_SOL };
  }

  async sendEth(toAddress: string, amountEth: number): Promise<string> {
    this.ensureArmed();
    const kp = this.keypair();
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: kp.publicKey,
        toPubkey: new PublicKey(toAddress),
        lamports: Math.round(amountEth * LAMPORTS_PER_SOL),
      }),
    );
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = kp.publicKey;
    tx.sign(kp);
    const sig = await this.connection.sendRawTransaction(tx.serialize());
    await this.confirmOrThrow(sig, blockhash, lastValidBlockHeight);
    return sig;
  }

  /** Wait for a tx to land AND check it did not revert. confirmTransaction
   *  RESOLVES (does not throw) for a tx that was included but failed on-chain
   *  (slippage, insufficient lamports, program revert) — so we MUST inspect
   *  `value.err`. Without this a reverted SOL payout would clear the author's
   *  escrow and a reverted swap would book a position/PnL that never happened. */
  private async confirmOrThrow(
    sig: string,
    blockhash: string,
    lastValidBlockHeight: number,
  ): Promise<void> {
    const conf = await this.connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      "confirmed",
    );
    if (conf.value.err) {
      throw new Error(`solana tx ${sig} failed on-chain: ${JSON.stringify(conf.value.err)}`);
    }
  }

  /** No $THESIS on Solana to burn — the Endowment routes the Solana buyback
   *  slice to SOLANA_BUYBACK_WALLET via sendEth, so this must never be called
   *  for a Solana position. */
  async buybackAndBurn(): Promise<{ txHash: string; tokensBurned: number }> {
    throw new Error(
      "buybackAndBurn is not supported on Solana — the buyback slice is sent to " +
        "SOLANA_BUYBACK_WALLET (see endowment). This call indicates a routing bug.",
    );
  }

  // --- Jupiter HTTP -------------------------------------------------------

  /** Timeout for Jupiter /quote + /swap — a hung host must not stall the swap
   *  loop indefinitely (the loop already has its own per-attempt budget). */
  private static readonly JUPITER_TIMEOUT_MS = 10_000;

  /** How many times to attempt each Jupiter HTTP call before giving up. */
  private static readonly JUPITER_MAX_TRIES = 4;

  /**
   * Jupiter HTTP with a bounded retry on TRANSIENT failures — network
   * `fetch failed` (DNS/connection reset), request timeout, 5xx, or 429.
   *
   * SAFE BY CONSTRUCTION: the only callers are /quote and /swap, which merely
   * BUILD the request — they run BEFORE any bundle is submitted on-chain
   * (submission is submitJitoBundle). So a retry here can never double-fill; it
   * just rides out a brief Jupiter blip instead of aborting the whole buy. A
   * deterministic 4xx (≠429) is returned as-is for the caller to throw on.
   */
  private async jupiterFetch(url: string, init?: RequestInit): Promise<Response> {
    let lastErr: unknown = new Error("jupiter fetch: no attempt made");
    for (let i = 0; i < RealSolanaChain.JUPITER_MAX_TRIES; i++) {
      try {
        const res = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(RealSolanaChain.JUPITER_TIMEOUT_MS),
        });
        if (res.ok || (res.status < 500 && res.status !== 429)) return res;
        lastErr = new Error(`Jupiter ${res.status}`);
      } catch (err) {
        lastErr = err; // `fetch failed` (DNS/connection) or AbortError (timeout)
      }
      if (i < RealSolanaChain.JUPITER_MAX_TRIES - 1) {
        log.warn(`solana/jupiter: transient HTTP failure (try ${i + 1}/${RealSolanaChain.JUPITER_MAX_TRIES}) — ${String(lastErr)}`);
        await new Promise((r) => setTimeout(r, 600 * 2 ** i)); // 0.6s, 1.2s, 2.4s
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private async getQuote(inputMint: string, outputMint: string, amount: string) {
    const bps = Math.max(1, Math.round(config.solana.slippagePct * 100));
    let url =
      `${config.solana.jupiterApiBase}/quote?inputMint=${inputMint}` +
      `&outputMint=${outputMint}&amount=${amount}&slippageBps=${bps}`;
    // Keep Jupiter off any DEX that locks a vote account: Jito rejects such a
    // bundle outright ("cannot lock any vote accounts") at every tip, so the
    // swap would be abandoned and the entry lost. Routing is dynamic, so we
    // exclude the known offenders on EVERY quote (buy and sell) rather than
    // hope for a clean route. See config.solana.excludeDexes.
    if (config.solana.excludeDexes.length > 0) {
      url += `&excludeDexes=${config.solana.excludeDexes.map(encodeURIComponent).join(",")}`;
    }
    const res = await this.jupiterFetch(url);
    if (!res.ok) throw new Error(`Jupiter /quote ${res.status}`);
    return parseJupiterQuote((await res.json()) as JupiterQuote);
  }

  /**
   * MEV-protected swap with an escalating Jito tip.
   *
   * Each attempt is a FRESH quote + a newly-built bundle at a higher tip, bound
   * by a short blockhash expiry so a non-landing attempt dies BEFORE the next one
   * fires — this is what prevents a double-fill across retries. We NEVER fall back
   * to the public RPC: if the tip ladder reaches the cap and still will not land,
   * the swap is ABANDONED with an alarm (an exposed fill is worse than a missed
   * one). Re-quoting per attempt keeps the price fresh on volatile tokens, and the
   * returned outAmount is from the quote that actually landed.
   *
   * SOLANA_JITO_ENABLED=false degrades to a single UNPROTECTED public submission
   * (testing only) — see {@link submitPublic}.
   */
  private async protectedSwap(
    inputMint: string,
    outputMint: string,
    amount: string,
  ): Promise<{ txHash: string; outAmount: string }> {
    if (!config.solana.jitoEnabled) {
      const quote = await this.getQuote(inputMint, outputMint, amount);
      const txHash = await this.submitPublic(quote);
      // Testing-only path: outAmount is the pre-swap quote, not necessarily the
      // landed amount. Acceptable here because production always uses Jito.
      return { txHash, outAmount: quote.outAmount };
    }

    const floor = await fetchTipFloor();
    const escalationSteps = config.solana.jitoMaxAttempts;
    const maxTip = config.solana.jitoMaxTipLamports;
    const maxTransient = config.solana.jitoMaxTransientRetries;
    let lastReason = "no attempts made";
    let transientRetries = 0;

    // `tier` is the tip-escalation level; it advances ONLY on a genuine
    // "accepted but did not land" (tip too low) or a deterministic reject — never
    // on a rate-limit, which a higher tip can't fix.
    let tier = 0;
    while (tier < escalationSteps) {
      const tip = tipForAttempt(floor, tier, { maxLamports: maxTip });
      const quote = await this.getQuote(inputMint, outputMint, amount);
      const built = await this.buildSwapTx(quote, tip);

      const submit = await submitJitoBundle(built.tx);
      if (!submit.ok) {
        // HTTP 429 — the block engine provably never took the bundle, so the
        // signed tx cannot land. Back off and resubmit the SAME tier (a fresh
        // tx/blockhash is built next loop). Double-fill-safe: the rejected tx is
        // dead-on-arrival. Escalating the tip here would just burn the budget.
        if (submit.retryable && submit.definitelyNotAccepted) {
          transientRetries++;
          if (transientRetries > maxTransient) {
            lastReason = `jito rate-limited (${submit.reason}) — gave up after ${maxTransient} retries`;
            break;
          }
          const backoff =
            submit.retryAfterMs ?? Math.min(5_000, 400 * 2 ** Math.min(transientRetries - 1, 4));
          log.warn(
            `solana/jito: ${submit.reason} (rate limit) — backing off ${backoff}ms, ` +
              `retry ${transientRetries}/${maxTransient} at tier ${tier + 1}`,
          );
          await new Promise((r) => setTimeout(r, backoff));
          continue; // same tier, same tip
        }

        // Ambiguous (5xx / network) or a deterministic reject. The tx we just
        // sent MIGHT have landed (the request may have reached the engine), so
        // confirm-or-expire it BEFORE building a new one — never blind-rebuild
        // over a possibly-live tx, that could double-fill.
        const maybeLanded = await this.confirmOrExpire(
          built.signature,
          built.blockhash,
          built.lastValidBlockHeight,
        );
        if (maybeLanded === "landed") {
          log.info(
            `solana/jito: swap landed despite submit error (${submit.reason}) ` +
              `at tier ${tier + 1} (tip ${tip}) — tx ${built.signature}`,
          );
          return { txHash: built.signature, outAmount: quote.outAmount };
        }
        lastReason = `jito submit failed (${submit.reason}) at tip ${tip}`;
        log.warn(`solana/jito: tier ${tier + 1}/${escalationSteps} — ${lastReason}, escalating`);
        tier++;
        if (tip >= maxTip) {
          lastReason = `tip cap ${maxTip} lamports reached, still not landing`;
          break;
        }
        continue;
      }

      const outcome = await this.confirmOrExpire(
        built.signature,
        built.blockhash,
        built.lastValidBlockHeight,
      );
      if (outcome === "landed") {
        log.info(
          `solana/jito: swap landed on tier ${tier + 1}/${escalationSteps} ` +
            `(tip ${tip} lamports) — tx ${built.signature}`,
        );
        return { txHash: built.signature, outAmount: quote.outAmount };
      }

      // Accepted but expired without landing = tip too low → escalate.
      lastReason = `bundle expired without landing at tip ${tip}`;
      log.warn(`solana/jito: tier ${tier + 1}/${escalationSteps} — ${lastReason}, escalating`);
      tier++;
      // Tip already pinned at the cap → a further tier would bid the same and
      // fail the same way. Stop and abandon rather than burn attempts.
      if (tip >= maxTip) {
        lastReason = `tip cap ${maxTip} lamports reached, still not landing`;
        break;
      }
    }

    // Never broadcast unprotected — abandon loudly (error → ops alarm) so the
    // operator can react (raise the cap, or close manually).
    logEvent({
      level: "error",
      area: "solana",
      type: "jito_swap_abandoned",
      msg:
        `solana/jito: ABANDONED ${inputMint}→${outputMint} — ${lastReason}. ` +
        `NOT broadcast on public RPC (MEV-protected mode).`,
    });
    throw new Error(
      `solana/jito: swap abandoned after ${escalationSteps} tiers — ${lastReason}. ` +
        `Raise SOLANA_JITO_MAX_TIP_LAMPORTS / SOLANA_JITO_MAX_ATTEMPTS if this recurs.`,
    );
  }

  /**
   * Build + sign a Jupiter swap tx with the MEV params: tight dynamic slippage,
   * an embedded Jito tip (Jupiter inserts the tip transfer), a dynamic compute
   * limit, and a short blockhash expiry. Returns the signed tx plus what
   * {@link confirmOrExpire} needs to await landing-or-expiry.
   */
  private async buildSwapTx(
    quoteResponse: JupiterQuote,
    jitoTipLamports: number,
  ): Promise<{
    tx: VersionedTransaction;
    signature: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    const body: Record<string, unknown> = {
      quoteResponse,
      userPublicKey: this.keypair().publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    };
    if (config.solana.dynamicSlippage) {
      // Jupiter simulates + picks a tight per-route slippage, capped here. This
      // replaces the loose static 8% — the single biggest anti-sandwich lever.
      body.dynamicSlippage = { maxBps: config.solana.slippageMaxBps };
    }
    if (jitoTipLamports > 0) {
      // Jupiter's oneOf: EITHER a priority fee OR a Jito tip. For a private
      // bundle the tip IS the inclusion incentive, so the tip is the right pick.
      body.prioritizationFeeLamports = { jitoTipLamports };
    }
    if (config.solana.jitoBlockhashSlotsToExpiry > 0) {
      body.blockhashSlotsToExpiry = config.solana.jitoBlockhashSlotsToExpiry;
    }

    // Pre-submission only (builds + signs locally; nothing is broadcast here),
    // so the bounded retry in jupiterFetch can never double-fill.
    const res = await this.jupiterFetch(`${config.solana.jupiterApiBase}/swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Jupiter /swap ${res.status}`);
    const built = parseJupiterSwap((await res.json()) as JupiterSwap);

    const tx = VersionedTransaction.deserialize(Buffer.from(built.swapTransaction, "base64"));
    tx.sign([this.keypair()]);
    // Guard: our keypair must be signer index 0 (single-fee-payer Jupiter route).
    // If a route ever puts a different signer first, signatures[0] stays all-zero
    // and bs58 would yield a useless sig we'd poll until expiry — fail loudly.
    const sigBytes = tx.signatures[0];
    if (!sigBytes || sigBytes.every((b) => b === 0)) {
      throw new Error("solana: tx signed but signatures[0] is empty — unexpected signer ordering");
    }
    const signature = bs58.encode(sigBytes);
    const blockhash = tx.message.recentBlockhash;
    // Jupiter returns lastValidBlockHeight for the blockhash it embedded; only
    // read a fresh height if an older host omitted it. The fallback is an upper
    // approximation (slot at our call ≥ Jupiter's), so it can over-wait slightly
    // before expiry — safe (never under-waits), just a touch slower to escalate.
    const lastValidBlockHeight =
      built.lastValidBlockHeight ??
      (await this.connection.getBlockHeight("confirmed")) + 150;
    return { tx, signature, blockhash, lastValidBlockHeight };
  }

  /**
   * Await a tx to land OR its blockhash to expire. Returns "landed" on success or
   * "expired" only when the tx has DEFINITIVELY never been seen on-chain (safe to
   * retry on a fresh blockhash). Throws on a real on-chain revert (value.err) so a
   * reverted swap is never booked as a fill.
   *
   * DOUBLE-FILL SAFETY (two traps, both closed here):
   *  1. We only treat `TransactionExpiredBlockheightExceededError` (the blockhash
   *     is permanently dead) as a retry candidate — NOT `TransactionExpiredTimeout`
   *     ("unknown if it succeeded or failed"), which we re-throw. Retrying an
   *     unknown-outcome tx could buy/sell twice.
   *  2. Even on blockheight-exceeded, a privately-submitted Jito bundle may have
   *     landed in a slot our (lagging) RPC had not surfaced. So before declaring
   *     "expired" we make an AUTHORITATIVE getSignatureStatuses check — only a
   *     signature the chain has truly never recorded is safe to retry.
   */
  private async confirmOrExpire(
    sig: string,
    blockhash: string,
    lastValidBlockHeight: number,
  ): Promise<"landed" | "expired"> {
    try {
      const conf = await this.connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed",
      );
      if (conf.value.err) {
        throw new Error(`solana tx ${sig} failed on-chain: ${JSON.stringify(conf.value.err)}`);
      }
      return "landed";
    } catch (err) {
      // ONLY a definitive blockheight-exceeded is a retry candidate. A timeout or
      // any other error has an unknown/failed outcome → never silently retry.
      if (!(err instanceof TransactionExpiredBlockheightExceededError)) throw err;
    }

    // Race guard: confirm the bundle truly never landed before allowing a retry.
    const outcome = await this.finalSignatureOutcome(sig);
    if (outcome === "reverted") {
      throw new Error(`solana tx ${sig} reverted on-chain (post-expiry status)`);
    }
    return outcome === "landed" ? "landed" : "expired";
  }

  /**
   * Authoritative post-expiry check: did this signature ever make it on-chain?
   * Polls getSignatureStatuses (searchTransactionHistory) a few times because the
   * confirmed view can lag the block height by a slot or two. ANY recorded status
   * without an error counts as landed (we never retry something the chain has
   * seen); an error → reverted; never seen after the polls → absent (safe retry).
   *
   * Honest gap: a status stuck at "processed" that is later forked out would be
   * (conservatively) treated as landed — we accept a rare under-fill over a
   * double-fill, and the monitor reconciles real balances downstream.
   */
  private async finalSignatureOutcome(sig: string): Promise<"landed" | "reverted" | "absent"> {
    for (let i = 0; i < 4; i++) {
      const { value } = await this.connection.getSignatureStatuses([sig], {
        searchTransactionHistory: true,
      });
      const st = value[0];
      if (st) {
        if (st.err) return "reverted";
        return "landed";
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    return "absent";
  }

  /**
   * UNPROTECTED public submission — only when SOLANA_JITO_ENABLED=false (testing).
   * Broadcasts on the public RPC where the swap can be sandwiched; kept solely so
   * the adapter still functions with Jito turned off.
   */
  private async submitPublic(quoteResponse: JupiterQuote): Promise<string> {
    const built = await this.buildSwapTx(quoteResponse, 0);
    await this.connection.sendRawTransaction(built.tx.serialize(), { maxRetries: 3 });
    await this.confirmOrThrow(built.signature, built.blockhash, built.lastValidBlockHeight);
    return built.signature;
  }
}
