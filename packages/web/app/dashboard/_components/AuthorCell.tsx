"use client";

/**
 * Author cell — the author's X avatar (28px round) + handle + a "VIEW THESIS ↗"
 * label, the whole block linking out to the original X post (`postUrl`) where the
 * trade thesis was written. Ported from the legacy `authorCell`.
 *
 * Avatars are best-effort: many authors have none on file and some URLs 404, so
 * we fall back to an initials chip and swap to it on `onError` — the same
 * graceful pattern as `TokenCell`, so a row never shows a broken-image glyph.
 *
 * When there's no `postUrl` the block renders as a plain (non-linked) span and
 * the "VIEW THESIS" affordance is hidden — we never dangle a dead link.
 */
import { useState } from "react";
import styles from "./dashboard.module.css";

export function AuthorCell({
  handle,
  avatarUrl,
  postUrl,
}: {
  handle: string;
  avatarUrl: string | null;
  postUrl: string | null;
}) {
  const [broken, setBroken] = useState(false);
  const label = handle || "@author";
  // Initials shown when there's no avatar image. Two letters off the handle
  // (sans a leading @) read as more identifying than one — matches the legacy
  // chip. Falls back to "?" for an empty/symbol-only handle.
  const initials = (handle || "?").replace(/^@/, "").slice(0, 2).toUpperCase() || "?";

  const inner = (
    <>
      {avatarUrl && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.acAvatar}
          src={avatarUrl}
          alt=""
          width={28}
          height={28}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className={styles.acAvatar} aria-hidden="true">
          {initials}
        </span>
      )}
      <span className={styles.acMeta}>
        <span className={styles.acHandle}>{label}</span>
        {postUrl ? <span className={styles.acView}>VIEW THESIS ↗</span> : null}
      </span>
    </>
  );

  return postUrl ? (
    <a
      className={styles.ac}
      href={postUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`View ${label}'s thesis on X`}
    >
      {inner}
    </a>
  ) : (
    <span className={styles.ac}>{inner}</span>
  );
}
