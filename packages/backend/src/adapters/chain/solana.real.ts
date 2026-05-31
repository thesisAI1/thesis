import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import bs58 from "bs58";
import { config } from "../../config.js";
import { log } from "../../util/log.js";
import type { ChainAdapter, SwapResult } from "./index.js";
import {
  parseJupiterQuote,
  parseJupiterSwap,
  type JupiterQuote,
  type JupiterSwap,
} from "./jupiter-parse.js";

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
 * SCAFFOLDED: written to be correct and typecheck-clean; live verification
 * happens once the Solana trading wallet is funded. The keypair is decoded
 * lazily so merely selecting this adapter (e.g. for a stray Solana submission on
 * a Base-only deployment) never throws — only an actual trade/read does.
 */
const WSOL = "So11111111111111111111111111111111111111112";

export class RealSolanaChain implements ChainAdapter {
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

  /** Mint decimals, cached (immutable per mint). */
  private async decimals(mint: string): Promise<number> {
    const hit = this.decimalsCache.get(mint);
    if (hit !== undefined) return hit;
    const info = await getMint(this.connection, new PublicKey(mint));
    this.decimalsCache.set(mint, info.decimals);
    return info.decimals;
  }

  /** SOL per whole token, from a live Jupiter quote selling 1 token. */
  async getTokenPriceEth(mint: string): Promise<number> {
    const dec = await this.decimals(mint);
    const oneToken = BigInt(10) ** BigInt(dec);
    const quote = await this.getQuote(mint, WSOL, oneToken.toString());
    return Number(quote.outAmount) / LAMPORTS_PER_SOL;
  }

  async buy(mint: string, amountInEth: number): Promise<SwapResult> {
    this.ensureArmed();
    const lamportsIn = BigInt(Math.round(amountInEth * LAMPORTS_PER_SOL));
    const quote = await this.getQuote(WSOL, mint, lamportsIn.toString());
    const dec = await this.decimals(mint);
    const txHash = await this.executeSwap(quote);
    const amountOut = Number(quote.outAmount) / 10 ** dec;
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
    const baseUnits = BigInt(Math.round(amountTokens * 10 ** dec));
    if (baseUnits <= 0n) throw new Error(`solana: cannot sell — 0 base units of ${mint}`);
    const quote = await this.getQuote(mint, WSOL, baseUnits.toString());
    const txHash = await this.executeSwap(quote);
    const proceedsEth = Number(quote.outAmount) / LAMPORTS_PER_SOL;
    const priceEth = amountTokens > 0 ? proceedsEth / amountTokens : 0;
    log.info(`solana: sell via Jupiter — ${amountTokens} of ${mint} → ${proceedsEth} SOL — tx ${txHash}`);
    return { txHash, amountOut: proceedsEth, priceEth };
  }

  async quoteSell(mint: string, amountTokens: number): Promise<{ proceedsEth: number }> {
    const dec = await this.decimals(mint);
    const baseUnits = BigInt(Math.round(amountTokens * 10 ** dec));
    if (baseUnits <= 0n) return { proceedsEth: 0 };
    const quote = await this.getQuote(mint, WSOL, baseUnits.toString());
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
    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = kp.publicKey;
    tx.sign(kp);
    const sig = await this.connection.sendRawTransaction(tx.serialize());
    await this.connection.confirmTransaction(sig, "confirmed");
    return sig;
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

  private async getQuote(inputMint: string, outputMint: string, amount: string) {
    const bps = Math.max(1, Math.round(config.solana.slippagePct * 100));
    const url =
      `${config.solana.jupiterApiBase}/quote?inputMint=${inputMint}` +
      `&outputMint=${outputMint}&amount=${amount}&slippageBps=${bps}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Jupiter /quote ${res.status}`);
    return parseJupiterQuote((await res.json()) as JupiterQuote);
  }

  private async executeSwap(quoteResponse: unknown): Promise<string> {
    const res = await fetch(`${config.solana.jupiterApiBase}/swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: this.keypair().publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
      }),
    });
    if (!res.ok) throw new Error(`Jupiter /swap ${res.status}`);
    const built = parseJupiterSwap((await res.json()) as JupiterSwap);
    const txBuf = Buffer.from(built.swapTransaction, "base64");
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([this.keypair()]);
    const sig = await this.connection.sendRawTransaction(tx.serialize(), {
      maxRetries: 3,
    });
    await this.connection.confirmTransaction(sig, "confirmed");
    return sig;
  }
}
