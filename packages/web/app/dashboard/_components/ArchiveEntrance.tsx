"use client";

/**
 * The dive — a one-shot "drawer opens" overlay played ONLY when you arrive at
 * the Record through the Faculty Office's Archive door (`/dashboard?from=archive`).
 *
 * The mechanism (built): detect the param, respect `prefers-reduced-motion`,
 * strip the param from the URL so a refresh/share never replays it, and unmount
 * after the animation. The *feel* (the `@keyframes archiveDive*` in
 * dashboard.module.css) is the tunable knob — see the marked block there.
 *
 * Lives under a <Suspense> in page.tsx because useSearchParams() suspends.
 */
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import styles from "./dashboard.module.css";

/** Must stay >= the longest archiveDive* animation in the CSS. */
const DIVE_MS = 920;

export function ArchiveEntrance() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [playing, setPlaying] = useState(false);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const fromArchive = params.get("from") === "archive";
    if (!fromArchive) return;

    // Strip the param immediately: keeps the URL deep-linkable/shareable and
    // stops a refresh from re-triggering the dive. The local `playing` state
    // already captured the intent, so the animation still runs.
    router.replace(pathname, { scroll: false });

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return; // honour reduced motion — no overlay at all

    setPlaying(true);
    const t = setTimeout(() => setPlaying(false), DIVE_MS);
    return () => clearTimeout(t);
  }, [params, pathname, router]);

  if (!playing) return null;

  return (
    <div className={styles.entrance} aria-hidden="true">
      <div className={`${styles.entranceHalf} ${styles.entranceTop}`} />
      <div className={`${styles.entranceHalf} ${styles.entranceBottom}`} />
      <span className={styles.entrancePlate}>OPENING THE ARCHIVE</span>
    </div>
  );
}
