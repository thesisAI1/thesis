/**
 * A process-wide async mutex.
 *
 * The service runs three concurrent loops (poll / review / monitor) plus the
 * HTTP admin handlers, all mutating the same in-memory store. Every store
 * method is individually atomic (synchronous read-modify-persist, no internal
 * await), but a LOGICAL transaction that spans several awaits — e.g. the
 * monitor reading an open position, awaiting an on-chain sell, then writing the
 * closed state and settling — is NOT atomic: a second concurrent path can
 * interleave at any await and act on the same position, double-settling it.
 *
 * withLock() serializes such critical sections: only one runs at a time,
 * FIFO. It is NOT reentrant — never call withLock() from inside another
 * withLock() on the same path, or it will deadlock.
 *
 * This is the lightweight fix for a single-process deployment. A multi-process
 * deployment would need real DB transactions (see the Store interface).
 */

let tail: Promise<unknown> = Promise.resolve();

/** Run `fn` once all previously-queued critical sections have settled. The
 *  caller receives `fn`'s real result/rejection; a rejection does NOT poison
 *  the lock for the next caller. */
export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = tail.then(() => fn());
  // The next caller waits for this one to settle, but is shielded from its
  // error (we swallow it here; the original caller still sees it via `result`).
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
