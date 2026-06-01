"use client";

/**
 * The filing drawers — the Record's four sections rendered as a sticky row of
 * cabinet-drawer fronts. This is "tabs = drawers": theme *and* genuine jump-nav
 * in one. The targets are the section anchors LiveDashboard already renders
 * (`#overview … #leaderboard`), so this is purely additive — the data islands
 * are untouched.
 *
 * Active drawer is tracked by an IntersectionObserver scroll-spy: whichever
 * section head is nearest the top of the viewport "pulls open".
 */
import { useEffect, useState } from "react";
import styles from "./dashboard.module.css";

interface Drawer {
  id: string;
  idx: string;
  label: string;
}

/** Mirrors the SectionHead ids/order in LiveDashboard. */
const DRAWERS: Drawer[] = [
  { id: "overview", idx: "01", label: "Overview" },
  { id: "positions", idx: "02", label: "Positions" },
  { id: "decisions", idx: "03", label: "Decision Log" },
  { id: "leaderboard", idx: "04", label: "Authors" },
];

export function DrawerTabs() {
  const [active, setActive] = useState<string>(DRAWERS[0].id);

  useEffect(() => {
    const heads = DRAWERS.map((d) => document.getElementById(d.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (heads.length === 0) return;

    // Account for the sticky TopBar + this drawer bar so the "active" section is
    // the one whose head has just scrolled under the chrome, not the one at the
    // very top edge.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-120px 0px -65% 0px", threshold: 0 },
    );
    heads.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  };

  return (
    <nav className={styles.drawerNav} aria-label="Archive sections">
      {DRAWERS.map((d) => {
        const on = active === d.id;
        return (
          <button
            key={d.id}
            type="button"
            className={`${styles.drawer}${on ? ` ${styles.drawerOn}` : ""}`}
            aria-current={on ? "true" : undefined}
            onClick={() => jump(d.id)}
          >
            <span className={styles.drawerIdx}>{d.idx}</span>
            <span className={styles.drawerLabel}>{d.label}</span>
            <span className={styles.drawerPull} aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
}
