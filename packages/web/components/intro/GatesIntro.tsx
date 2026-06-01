"use client";

/**
 * First-visit "Gates" intro — a cinematic AI gatehouse clip (gates swing open →
 * push through into light) that blooms into the live site. Plays once per
 * browser, responsive 16:9 / 9:16 source, cut-on-white bloom transition, with
 * reduced-motion + autoplay-block fallbacks.
 *
 * Gating is decided SERVER-SIDE: app/layout.tsx reads the `thesis_intro_seen`
 * cookie and passes `firstVisit`, so the overlay renders in the correct state
 * on first paint — covering the page for new visitors (no flash of content) and
 * absent for returning ones (no inline script, no overlay flash). The cookie is
 * written here when the entrance finishes.
 *
 * The controller is imperative (refs + classList inside one effect): it mirrors
 * the verified vanilla timeline and keeps the <video> out of React's render
 * path, so a re-render never interrupts playback.
 */
import { useEffect, useRef } from "react";
import styles from "./GatesIntro.module.css";

const COOKIE = "thesis_intro_seen";
const DESK = { mp4: "/intro/gates-open.mp4", poster: "/intro/gates-poster.jpg" };
const MOB = { mp4: "/intro/gates-open-mobile.mp4", poster: "/intro/gates-poster-mobile.jpg" };

export function GatesIntro({ firstVisit }: { firstVisit: boolean }) {
  const introRef = useRef<HTMLDivElement>(null);
  const filmRef = useRef<HTMLVideoElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const tapRef = useRef<HTMLButtonElement>(null);
  const replayRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const intro = introRef.current;
    const film = filmRef.current;
    const flash = flashRef.current;
    const skip = skipRef.current;
    const tap = tapRef.current;
    const replay = replayRef.current;
    if (!intro || !film || !flash || !skip || !tap || !replay) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let entering = false;

    const setSeen = () => {
      document.cookie = `${COOKIE}=1; max-age=31536000; path=/; samesite=lax`;
    };
    const source = () =>
      window.matchMedia("(max-aspect-ratio: 4/5)").matches ? MOB : DESK;
    const visible = () =>
      intro.classList.contains(styles.armed) && !intro.classList.contains(styles.gone);

    // pass THROUGH the gate: bloom to light, swap the film out under peak white, recede
    function enterThroughLight() {
      if (entering) return;
      entering = true;
      flash!.classList.add(styles.bloom);
      window.setTimeout(() => {
        intro!.classList.add(styles.gone);
        try { film!.pause(); } catch { /* ignore */ }
        setSeen();
        flash!.classList.add(styles.clear);
        window.setTimeout(() => replay!.classList.add(styles.show), 250);
      }, 600);
    }
    function revealInstant() {
      intro!.classList.add(styles.gone);
      try { film!.pause(); } catch { /* ignore */ }
      setSeen();
      replay!.classList.add(styles.show);
    }
    const enter = () => (reduce ? revealInstant() : enterThroughLight());

    function onTime() {
      if (!film!.duration) return;
      const left = film!.duration - film!.currentTime;
      if (left < 2.3) intro!.classList.add(styles.closingIn); // closing line fades in
      if (left < 0.7) enterThroughLight(); // bloom as the frame brightens
    }
    function play() {
      entering = false;
      intro!.classList.add(styles.armed);
      intro!.classList.remove(styles.gone, styles.closingIn);
      flash!.classList.remove(styles.bloom, styles.clear);
      replay!.classList.remove(styles.show);
      tap!.hidden = true;

      const s = source();
      film!.preload = "auto";
      film!.poster = s.poster;
      if (film!.getAttribute("src") !== s.mp4) {
        film!.setAttribute("src", s.mp4);
        film!.load();
      }
      if (reduce) { tap!.hidden = false; return; } // hold the poster, offer Enter
      try { film!.currentTime = 0; } catch { /* ignore */ }
      const p = film!.play();
      if (p && typeof p.catch === "function") p.catch(() => { tap!.hidden = false; });
    }
    function onTap() {
      tap!.hidden = true;
      if (reduce) { revealInstant(); return; }
      const p = film!.play(); // user gesture satisfies autoplay policy
      if (p && typeof p.catch === "function") p.catch(enterThroughLight);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" && visible()) enter();
    }

    film.addEventListener("timeupdate", onTime);
    film.addEventListener("ended", enterThroughLight);
    skip.addEventListener("click", enter);
    tap.addEventListener("click", onTap);
    replay.addEventListener("click", play);
    document.addEventListener("keydown", onKey);

    // boot: server already rendered the overlay armed/hidden per firstVisit
    if (firstVisit) play();
    else replay.classList.add(styles.show);

    return () => {
      film.removeEventListener("timeupdate", onTime);
      film.removeEventListener("ended", enterThroughLight);
      skip.removeEventListener("click", enter);
      tap.removeEventListener("click", onTap);
      replay.removeEventListener("click", play);
      document.removeEventListener("keydown", onKey);
    };
  }, [firstVisit]);

  return (
    <>
      <div ref={introRef} className={firstVisit ? `${styles.intro} ${styles.armed}` : styles.intro}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={filmRef}
          className={styles.film}
          muted
          playsInline
          preload="none"
          poster="/intro/gates-poster.jpg"
          src="/intro/gates-open.mp4"
        />
        <div className={styles.vignette} aria-hidden="true" />
        <p className={styles.eyebrow}>
          THE FACULTY OF THESIS&nbsp;&nbsp;&middot;&nbsp;&nbsp;EST. ON BASE
        </p>
        <p className={styles.closing}>The committee will see you now.</p>
        <button ref={skipRef} type="button" className={styles.skip}>skip &#9166;</button>
        <button ref={tapRef} type="button" className={styles.tap} hidden>
          &#9656; enter the faculty
        </button>
      </div>
      <div ref={flashRef} className={styles.flash} aria-hidden="true" />
      <button ref={replayRef} type="button" className={styles.replay}>
        &#9656; replay the entrance
      </button>
    </>
  );
}
