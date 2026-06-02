"use client";

/**
 * Token cell — the DexScreener logo (20px round) + the `$SYMBOL` / truncated-CA
 * label + an optional launchpad source badge + a copy-CA button, used in the
 * open & closed position tables. Mirrors the legacy `tokenCell`.
 *
 * The label links to the token's DexScreener chart (chain-aware), and the small
 * trailing button copies the full contract address with a brief ✓ confirmation.
 *
 * Logos are best-effort: many tokens have none on file, and some URLs 404. So
 * we fall back to a lettered chip when there's no `logoUrl`, and swap to that
 * same chip if the image fails to load (`onError`) — the row never shows a
 * broken-image glyph.
 */
import { useState } from "react";
import type { Chain } from "@thesis/shared";
import { dexscreenerUrl, tokenLabel } from "./format";
import styles from "./dashboard.module.css";

/** Material "content_copy" — single-path inline SVG, the shape DexScreener uses. */
function CopyGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
    </svg>
  );
}

/** Checkmark shown for ~1.3s after a successful copy. */
function CheckGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    </svg>
  );
}

/** Display label for a launchpad key. pump.fun keeps its dot; the rest just
 *  uppercase. Returns null for an unknown/absent source (no badge rendered). */
function launchpadLabel(launchpad: string | null | undefined): string | null {
  const lp = launchpad?.toLowerCase();
  if (!lp) return null;
  return lp === "pumpfun" ? "PUMP.FUN" : lp.toUpperCase();
}

export function TokenCell({
  symbol,
  contractAddress,
  logoUrl,
  chain,
  launchpad = null,
}: {
  symbol: string;
  contractAddress: string;
  logoUrl: string | null;
  /** Decides the DexScreener path slug (base / solana / …). */
  chain: Chain;
  /** Launchpad source — rendered as a small badge after the token label. */
  launchpad?: string | null;
}) {
  const [broken, setBroken] = useState(false);
  const [copied, setCopied] = useState(false);
  const label = tokenLabel(symbol, contractAddress);
  const lpLabel = launchpadLabel(launchpad);
  // Fallback letter: first char of the symbol (sans $/@), else the first char of
  // the address after its 0x prefix. Strip prefixes precisely — a char-class like
  // [$@0x] would also eat a leading "X"/"0" inside a real symbol (e.g. $XROCKET).
  const base = symbol ? symbol.replace(/^[$@]/, "") : contractAddress.replace(/^0x/i, "");
  const letter = (base.charAt(0) || "?").toUpperCase();

  const copy = () => {
    // navigator.clipboard is present on localhost + any https origin (both are
    // "secure contexts"); guard so a stray http origin no-ops rather than throws.
    navigator.clipboard?.writeText(contractAddress).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1300);
      },
      () => {
        /* clipboard denied — leave the icon unchanged */
      },
    );
  };

  return (
    <span className={styles.tokCell}>
      {logoUrl && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.tokLogo}
          src={logoUrl}
          alt=""
          width={20}
          height={20}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className={`${styles.tokLogo} ${styles.tokLogoFallback}`} aria-hidden="true">
          {letter}
        </span>
      )}
      <a
        className={styles.tok}
        href={dexscreenerUrl(chain, contractAddress)}
        target="_blank"
        rel="noopener noreferrer"
        title={`${contractAddress} — open chart on DexScreener`}
      >
        {label}
      </a>
      {lpLabel && (
        <span
          className={styles.lpBadge}
          data-lp={launchpad?.toLowerCase()}
          title={`Launchpad: ${lpLabel}`}
        >
          {lpLabel}
        </span>
      )}
      <button
        type="button"
        className={`${styles.tokCopy} ${copied ? styles.tokCopied : ""}`}
        onClick={copy}
        title="Copy contract address"
        aria-label={copied ? "Copied" : "Copy contract address"}
      >
        {copied ? <CheckGlyph /> : <CopyGlyph />}
      </button>
    </span>
  );
}
