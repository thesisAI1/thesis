"use client";

/**
 * Client-side pagination for the trade tables. The dashboard payload already
 * ships every position to the browser (and re-polls them), so paging is a pure
 * view concern — no API round-trips.
 *
 * `usePagination` clamps rather than resets when the source array changes, so a
 * 15s poll that mutates the Open-positions list doesn't yank the reader back to
 * page 1; it only snaps back if the list shrank beneath the current page.
 * Callers that want a hard reset on a *filter* change (History) call setPage(0)
 * themselves.
 */
import { useEffect, useMemo, useState } from "react";
import styles from "./dashboard.module.css";

export interface Pagination<T> {
  page: number;
  setPage: (p: number) => void;
  /** The current page's slice of items. */
  pageItems: T[];
  /** Total items across all pages. */
  total: number;
  totalPages: number;
  /** 1-based index of the first/last shown item (0 when empty). */
  from: number;
  to: number;
  pageSize: number;
}

export function usePagination<T>(items: T[], pageSize: number): Pagination<T> {
  const [page, setPage] = useState(0);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Clamp (don't reset) when the list shrinks beneath the current page — e.g. a
  // poll dropped rows, or a filter narrowed the set.
  useEffect(() => {
    if (page > totalPages - 1) setPage(totalPages - 1);
  }, [page, totalPages]);

  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * pageSize;
  const pageItems = useMemo(
    () => items.slice(start, start + pageSize),
    [items, start, pageSize],
  );

  return {
    page: safePage,
    setPage,
    pageItems,
    total,
    totalPages,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, total),
    pageSize,
  };
}

/** A ledger-style pager footer: "Showing 1–10 of 142 trades" + Prev/Next.
 *  Renders nothing when everything fits on one page. */
export function Pager({ p, noun = "rows" }: { p: Pagination<unknown>; noun?: string }) {
  if (p.total <= p.pageSize) return null;
  return (
    <div className={styles.pager}>
      <span className={styles.pagerInfo}>
        Showing <b>{p.from}–{p.to}</b> of {p.total} {noun}
      </span>
      <div className={styles.pagerCtl}>
        <button
          type="button"
          className={styles.pagerBtn}
          disabled={p.page === 0}
          onClick={() => p.setPage(p.page - 1)}
          aria-label="Previous page"
        >
          ←&nbsp;Prev
        </button>
        <span className={styles.pagerPage}>
          {p.page + 1}&nbsp;/&nbsp;{p.totalPages}
        </span>
        <button
          type="button"
          className={styles.pagerBtn}
          disabled={p.page >= p.totalPages - 1}
          onClick={() => p.setPage(p.page + 1)}
          aria-label="Next page"
        >
          Next&nbsp;→
        </button>
      </div>
    </div>
  );
}
