"use client";

/**
 * Token cell — the DexScreener logo (20px round) + the `$SYMBOL` / truncated-CA
 * label, used in the open & closed position tables. Mirrors the legacy
 * `tokenCell`.
 *
 * Logos are best-effort: many tokens have none on file, and some URLs 404. So
 * we fall back to a lettered chip when there's no `logoUrl`, and swap to that
 * same chip if the image fails to load (`onError`) — the row never shows a
 * broken-image glyph.
 */
import { useState } from "react";
import { tokenLabel } from "./format";
import styles from "./dashboard.module.css";

export function TokenCell({
  symbol,
  contractAddress,
  logoUrl,
}: {
  symbol: string;
  contractAddress: string;
  logoUrl: string | null;
}) {
  const [broken, setBroken] = useState(false);
  const label = tokenLabel(symbol, contractAddress);
  // Fallback letter: first char of the symbol (sans $/@), else the first char of
  // the address after its 0x prefix. Strip prefixes precisely — a char-class like
  // [$@0x] would also eat a leading "X"/"0" inside a real symbol (e.g. $XROCKET).
  const base = symbol ? symbol.replace(/^[$@]/, "") : contractAddress.replace(/^0x/i, "");
  const letter = (base.charAt(0) || "?").toUpperCase();

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
      <span className={styles.tok}>{label}</span>
    </span>
  );
}
