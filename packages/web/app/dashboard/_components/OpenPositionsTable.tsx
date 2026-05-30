"use client";

/**
 * Open-positions table (mockup `#pane-open`). Live cells: market cap, tier
 * progress and unrealised PnL. When a position's unrealised % changes between
 * polls the PnL cell flashes green (up) or red (down) — driven by REAL data, not
 * a random walk. The flash class is re-armed each change via a render nonce.
 */
import { useEffect, useRef, useState } from "react";
import type { OpenPositionView } from "@/lib/api";
import {
  fmtEthSigned,
  fmtMc,
  fmtPct,
  gradeClass,
  tokenLabel,
} from "./format";
import styles from "./dashboard.module.css";

export interface OpenPositionsTableProps {
  positions: OpenPositionView[];
}

type FlashDir = "up" | "dn" | null;

/** The laddered tier-progress bar (mockup `tierCell`). Filled segments for hit
 *  tiers, a partially-filled current segment, captioned with the next target. */
function TierBar({ pos }: { pos: OpenPositionView }) {
  const targets = pos.tierTargets;
  const count = Math.max(targets.length, pos.tierCount, 1);
  const hit = Math.min(pos.tiersHit, count);

  const segs = Array.from({ length: count }, (_, i) => {
    if (i < hit) return <div key={i} className={`${styles.tpSeg} ${styles.hit}`} />;
    if (i === hit) {
      const prev = i > 0 ? targets[i - 1]?.gainPct ?? 0 : 0;
      const next = targets[i]?.gainPct ?? prev + 100;
      const range = next - prev || 1;
      const fill = Math.max(0, Math.min(100, ((pos.unrealizedPct - prev) / range) * 100));
      return (
        <div key={i} className={`${styles.tpSeg}`}>
          <div className={styles.tpFill} style={{ width: `${fill.toFixed(0)}%` }} />
        </div>
      );
    }
    return <div key={i} className={styles.tpSeg} />;
  });

  const left =
    hit === 0 ? (
      <span>{fmtPct(pos.unrealizedPct)}</span>
    ) : (
      <span className={styles.g}>
        TP{hit} · +{targets[hit - 1]?.gainPct ?? 0}%
      </span>
    );
  const right =
    hit >= count ? (
      <span>trailing stop</span>
    ) : (
      <span>
        → TP{hit + 1} +{targets[hit]?.gainPct ?? 0}%
      </span>
    );

  return (
    <div className={styles.tp}>
      <div className={styles.tpBar}>{segs}</div>
      <div className={styles.tpCap}>
        {left}
        {right}
      </div>
    </div>
  );
}

/** One row, owning its own flash state so a change to one position doesn't
 *  re-flash the whole table. */
function OpenRow({ pos }: { pos: OpenPositionView }) {
  const prevPct = useRef(pos.unrealizedPct);
  const [flash, setFlash] = useState<FlashDir>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (pos.unrealizedPct !== prevPct.current) {
      setFlash(pos.unrealizedPct > prevPct.current ? "up" : "dn");
      setNonce((n) => n + 1);
      prevPct.current = pos.unrealizedPct;
    }
  }, [pos.unrealizedPct]);

  const up = pos.unrealizedPnlEth >= 0;
  const flashCls = flash === "up" ? styles.flashUp : flash === "dn" ? styles.flashDn : "";

  return (
    <tr>
      <td>
        <span className={styles.tok}>{tokenLabel(pos.tokenSymbol, pos.contractAddress)}</span>
      </td>
      <td>
        <span className={styles.author}>{pos.authorHandle}</span>
      </td>
      <td>
        <span className={`${styles.gcell} ${styles[gradeClass(pos.grade)]}`}>
          {pos.grade ?? "—"}
        </span>
      </td>
      <td>
        <TierBar pos={pos} />
      </td>
      <td className={styles.tRight}>{pos.amountInEth.toFixed(4)}</td>
      <td className={styles.tRight}>{fmtMc(pos.marketCapNowUsd)}</td>
      <td
        key={nonce}
        className={`${styles.tRight} ${up ? styles.pos : styles.neg} ${flashCls}`}
      >
        {fmtEthSigned(pos.unrealizedPnlEth)} ({fmtPct(pos.unrealizedPct)})
      </td>
    </tr>
  );
}

export function OpenPositionsTable({ positions }: OpenPositionsTableProps) {
  return (
    <div className={styles.card}>
      <div className={styles.tblWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Token</th>
              <th>Author</th>
              <th>Grade</th>
              <th>Stage</th>
              <th className={styles.tRight}>Size</th>
              <th className={styles.tRight}>Market cap</th>
              <th className={styles.tRight}>Unrealised</th>
            </tr>
          </thead>
          <tbody>
            {positions.length ? (
              positions.map((pos) => <OpenRow key={pos.id} pos={pos} />)
            ) : (
              <tr className={styles.emptyRow}>
                <td colSpan={7}>No open positions.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
