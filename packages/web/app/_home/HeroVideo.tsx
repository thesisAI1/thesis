"use client";

/**
 * Full-bleed Seedance hero background — the clean Θ-in-void loop.
 *
 * mp4-only (a VP9 webm with broken duration metadata was stalling the loop),
 * forced-CFR + crossfade so it loops continuously forward (no boomerang, no
 * freeze). The five faculty orbs are NOT baked in here — they live in the
 * OrbField DOM layer so they can detach and scroll into the pipeline.
 * Reduced-motion users get the still poster. A left+bottom scrim keeps the
 * headline legible on desktop.
 */
import { useEffect, useState } from "react";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function HeroVideo() {
  const reduced = usePrefersReducedMotion();
  const poster = "/hero/hero-theta.jpg";

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      {reduced ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" className="h-full w-full object-cover" />
      ) : (
        <video
          className="h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          poster={poster}
          preload="auto"
        >
          <source src="/hero/hero-theta.mp4" type="video/mp4" />
        </video>
      )}
      {/* Bottom fade — blends the footage into the void below (on mobile, into the
          headline block beneath; on desktop, into the next section). Always on. */}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(0deg, var(--void) 0%, transparent 38%)" }}
      />
      {/* Left scrim — desktop only, where the headline overlays the footage. */}
      <div
        className="absolute inset-0 hidden md:block"
        style={{
          background:
            "linear-gradient(90deg, var(--void) 0%, color-mix(in srgb, var(--void) 80%, transparent) 36%, transparent 72%)",
        }}
      />
    </div>
  );
}
