"use client";

/**
 * OrbField — the five faculty orbs bridging hero → pipeline.
 *
 * Fixed, pointer-events-none. Each frame it reads the live screen rect of the
 * hero Θ anchor (`[data-orb-anchor="theta"]`) and each orb's pipeline dock
 * (`[data-orb-dock]`). An orb orbits the Θ in a wide ellipse, then peels out
 * and docks as its card scrolls up.
 *
 * Card reveal is DECOUPLED from the orb: a card unfurls as soon as it enters
 * the viewport (its own `top` crossing the fold) so content renders early; the
 * orb + comet trail are a flourish that lands on it. Comet trails are derived
 * from frame-to-frame velocity (length/opacity scale with speed → vanish on
 * dock). Orbit centre is clamped on-screen. Reduced motion: everything static.
 */
import { useEffect, useRef } from "react";

const ORBS = [
  { id: "reg", color: "var(--blue)" },
  { id: "aud", color: "var(--accent)" },
  { id: "dean", color: "var(--purple)" },
  { id: "bursar", color: "var(--green)" },
  { id: "endow", color: "var(--red)" },
] as const;

const BASE = 19; // orb diameter px
const SPEED = 0.2; // orbit angular speed (rad/s)
const TAIL_W = 92; // max comet-trail length px
const TAIL_H = 11;
const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function OrbField() {
  const orbRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const tailRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const prev = useRef<Array<{ x: number; y: number } | null>>(new Array(ORBS.length).fill(null));

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let theta: Element | null = null;
    let pipe: Element | null = null;
    const docks: Array<Element | null> = new Array(ORBS.length).fill(null);
    const cards: Array<Element | null> = new Array(ORBS.length).fill(null);

    const resolve = () => {
      theta = document.querySelector('[data-orb-anchor="theta"]');
      pipe = document.querySelector("#process");
      ORBS.forEach((o, i) => {
        const d = document.querySelector(`[data-orb-dock="${o.id}"]`);
        docks[i] = d;
        cards[i] = d ? d.closest("[data-stage]") : null;
      });
      pipe?.setAttribute("data-orbs-live", "true"); // arm the card unfurl (JS only)
    };
    resolve();

    const place = (now: number) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const mobile = vw < 768;
      if (!theta || !pipe) resolve();

      const tr = theta?.getBoundingClientRect();
      const cx = clamp(tr ? tr.left : vw * 0.55, vw * 0.16, vw * 0.84);
      const cy = clamp(tr ? tr.top : vh * 0.45, vh * 0.14, vh * 0.9);
      const rx = mobile ? vw * 0.3 : Math.min(vw * 0.21, 380);
      const ry = mobile ? vw * 0.22 : Math.min(vh * 0.42, 400);
      const t = now / 1000;

      for (let i = 0; i < ORBS.length; i++) {
        const el = orbRefs.current[i];
        if (!el) continue;
        if (!docks[i]) {
          const d = document.querySelector(`[data-orb-dock="${ORBS[i].id}"]`);
          docks[i] = d;
          cards[i] = d ? d.closest("[data-stage]") : null;
        }
        const dk = docks[i]?.getBoundingClientRect();
        const dockTop = dk ? dk.top : vh * 3;

        // orb flight: orbit when its dock is low, dock fast as it rises (short
        // 0.22vh travel so the orb gets inside the card almost as it enters)
        const pi = reduced ? 1 : clamp01((vh * 1.08 - dockTop) / (vh * 0.22));
        const e = easeInOut(pi);
        const ang = i * (TAU / ORBS.length) + t * SPEED;
        const ox = cx + rx * (1 - e) * Math.cos(ang);
        const oy = cy + ry * (1 - e) * Math.sin(ang);
        const dx = dk ? dk.left + dk.width / 2 : ox;
        const dy = dk ? dk.top + dk.height / 2 : oy;
        const x = lerp(ox, dx, e);
        const y = lerp(oy, dy, e);
        const scale = 0.86 + 0.34 * (1 - e);

        el.style.transform = `translate3d(${x - BASE / 2}px, ${y - BASE / 2}px, 0) scale(${scale})`;
        el.style.opacity = "1";

        // comet trail from frame-to-frame velocity
        const tail = tailRefs.current[i];
        const p = prev.current[i];
        if (tail) {
          if (p && !reduced) {
            const vx = x - p.x;
            const vy = y - p.y;
            const sp = Math.hypot(vx, vy);
            const len = Math.min(sp * 7, TAIL_W);
            const adeg = (Math.atan2(vy, vx) * 180) / Math.PI;
            tail.style.transform = `translate3d(${x - TAIL_W}px, ${y - TAIL_H / 2}px, 0) rotate(${adeg}deg) scaleX(${len / TAIL_W})`;
            tail.style.opacity = String(Math.min(sp * 0.07, 0.72));
          } else {
            tail.style.opacity = "0";
          }
        }
        prev.current[i] = { x, y };

        // EARLY card reveal — driven by the card's own entry, not the orb
        const card = cards[i];
        if (card) {
          const ct = reduced ? -1 : card.getBoundingClientRect().top;
          if (ct < vh * 0.96) card.setAttribute("data-active", "true");
          else if (ct > vh * 1.06) card.removeAttribute("data-active");
        }
      }
    };

    if (reduced) {
      const tick = () => place(0);
      tick();
      window.addEventListener("scroll", tick, { passive: true });
      window.addEventListener("resize", tick);
      return () => {
        window.removeEventListener("scroll", tick);
        window.removeEventListener("resize", tick);
      };
    }

    let raf = 0;
    let active = true;
    const loop = (now: number) => {
      place(now);
      if (active) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onResize = () => resolve();
    window.addEventListener("resize", onResize);

    let io: IntersectionObserver | null = null;
    if (pipe) {
      io = new IntersectionObserver(
        (entries) => {
          const visible = entries[0]?.isIntersecting ?? true;
          if (visible && !active) {
            active = true;
            raf = requestAnimationFrame(loop);
          } else if (!visible) {
            active = false;
            cancelAnimationFrame(raf);
          }
        },
        { rootMargin: "160% 0px 100% 0px" },
      );
      io.observe(pipe);
    }

    return () => {
      active = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      io?.disconnect();
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-[30]" aria-hidden="true">
      {/* comet trails (behind the orbs) */}
      {ORBS.map((o, i) => (
        <span
          key={`tail-${o.id}`}
          ref={(el) => {
            tailRefs.current[i] = el;
          }}
          className="absolute left-0 top-0"
          style={{
            width: TAIL_W,
            height: TAIL_H,
            opacity: 0,
            borderRadius: TAIL_H / 2,
            transformOrigin: "100% 50%",
            background: `linear-gradient(90deg, transparent, color-mix(in srgb, ${o.color} 72%, transparent))`,
            filter: "blur(1px)",
            willChange: "transform, opacity",
          }}
        />
      ))}
      {/* orbs */}
      {ORBS.map((o, i) => (
        <span
          key={o.id}
          ref={(el) => {
            orbRefs.current[i] = el;
          }}
          className="absolute left-0 top-0 rounded-full"
          style={{
            width: BASE,
            height: BASE,
            opacity: 0,
            background: `radial-gradient(circle at 50% 38%, #fff, ${o.color} 46%, color-mix(in srgb, ${o.color} 20%, transparent) 82%)`,
            boxShadow: `0 0 18px 3px color-mix(in srgb, ${o.color} 60%, transparent)`,
            willChange: "transform",
          }}
        />
      ))}
    </div>
  );
}
