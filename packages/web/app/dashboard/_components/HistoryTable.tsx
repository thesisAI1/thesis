"use client";

/**
 * Closed-positions history (mockup `#pane-hist`). Search by token/author and
 * filter by result (win/loss); grade is not on ClosedPositionView so we expose
 * the win/loss chips the data supports plus the free-text search.
 */
import { useEffect, useMemo, useState } from "react";
import type { ClosedPositionView } from "@/lib/api";
import { nativeSymbol } from "@/lib/chain";
import { fmtEthSigned, fmtPct, timeAgo, tokenLabel } from "./format";
import { SearchIcon } from "./icons";
import { Pager, usePagination } from "./Pager";
import styles from "./dashboard.module.css";

export interface HistoryTableProps {
  positions: ClosedPositionView[];
}

type Result = "all" | "win" | "loss";

const RESULTS: Array<{ key: Result; label: string }> = [
  { key: "all", label: "ALL" },
  { key: "win", label: "WIN" },
  { key: "loss", label: "LOSS" },
];

/** Rows per page. Tunable — matches the Open table for a consistent ledger. */
const PAGE_SIZE = 10;

export function HistoryTable({ positions }: HistoryTableProps) {
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<Result>("all");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return positions.filter((p) => {
      if (result === "win" && p.realisedPnlEth < 0) return false;
      if (result === "loss" && p.realisedPnlEth >= 0) return false;
      if (q) {
        const hay = `${p.tokenSymbol} ${p.contractAddress} ${p.authorHandle}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [positions, search, result]);

  const pg = usePagination(rows, PAGE_SIZE);
  const { setPage } = pg;
  // A new search/filter is a new query — start at the first page.
  useEffect(() => {
    setPage(0);
  }, [search, result, setPage]);

  return (
    <>
      <div className={styles.filters}>
        <div className={styles.search}>
          <SearchIcon />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search token or author…"
            aria-label="Search closed positions"
          />
        </div>
        <span className={styles.flabel}>Result</span>
        <div className={styles.chips}>
          {RESULTS.map((r) => (
            <button
              key={r.key}
              type="button"
              className={result === r.key ? styles.on : ""}
              onClick={() => setResult(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.tblWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Token</th>
                <th>Author</th>
                <th className={styles.tRight}>Size</th>
                <th className={styles.tRight}>Entry</th>
                <th className={styles.tRight}>Exit</th>
                <th className={styles.tRight}>Realised</th>
                <th className={styles.tRight}>Closed</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                pg.pageItems.map((p) => {
                  const up = p.realisedPnlEth >= 0;
                  return (
                    <tr key={p.id}>
                      <td>
                        <span className={styles.tok}>
                          {tokenLabel(p.tokenSymbol, p.contractAddress)}
                        </span>
                      </td>
                      <td>
                        <span className={styles.author}>{p.authorHandle}</span>
                      </td>
                      <td className={styles.tRight}>{p.amountInEth.toFixed(4)}</td>
                      <td className={`${styles.tRight} ${styles.dimCell}`}>
                        {p.entryPriceEth.toExponential(2)} {nativeSymbol(p.chain)}
                      </td>
                      <td className={styles.tRight}>
                        {p.exitPriceEth.toExponential(2)} {nativeSymbol(p.chain)}
                      </td>
                      <td className={`${styles.tRight} ${up ? styles.pos : styles.neg}`}>
                        {fmtEthSigned(p.realisedPnlEth)} ({fmtPct(p.realisedPct)})
                      </td>
                      <td className={`${styles.tRight} ${styles.dimCell}`}>
                        {timeAgo(p.closedAt)}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr className={styles.emptyRow}>
                  <td colSpan={7}>No trades match the filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager p={pg} noun="trades" />
      </div>
    </>
  );
}
