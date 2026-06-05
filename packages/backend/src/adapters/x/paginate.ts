/**
 * Cursor pagination for the X API — pure, so the "drain every page" loop is
 * unit-tested without a live HTTP client.
 *
 * The X v2 mentions endpoint caps a single response at `max_results` (100) and
 * returns a `meta.next_token` when more results match. The old code read only
 * the first page, so a poll that found >100 new mentions (a burst, or a restart
 * backlog) silently dropped everything past the first page. drainPages follows
 * next_token until the backlog is exhausted or `maxPages` is hit (a safety cap
 * so a runaway cursor can't make unbounded API calls).
 */

/** One page of results plus the token for the next page (absent = last page). */
export interface Page<T> {
  items: T[];
  nextToken?: string;
}

/**
 * Fetch pages via `fetchPage` (called with the previous page's token, or
 * undefined for the first) until a page has no `nextToken` or `maxPages` pages
 * have been fetched. Returns every item across all fetched pages, in fetch
 * order. `maxPages` must be >= 1.
 */
export async function drainPages<T>(
  fetchPage: (pageToken?: string) => Promise<Page<T>>,
  maxPages: number,
): Promise<T[]> {
  const all: T[] = [];
  let token: string | undefined;
  for (let page = 0; page < Math.max(1, maxPages); page++) {
    const { items, nextToken } = await fetchPage(token);
    all.push(...items);
    if (!nextToken) break;
    token = nextToken;
  }
  return all;
}
