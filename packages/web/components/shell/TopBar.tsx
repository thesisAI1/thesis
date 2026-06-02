"use client";

/**
 * The site nav (design `.bar`) — one solid, consistent bar on every page.
 *
 * A fixed, opaque sticky header: the ΘTHESIS wordmark, a single route-based
 * link set (Home · The Archive · Leaderboard · Pitch · Docs · $THESIS), the GitHub + X icon
 * links and the amber "Submit a thesis" CTA. The active page is derived from
 * the current route via `usePathname`, so the same nav renders identically on
 * the home page, the live record, the pitch page and the docs — no per-page
 * variants.
 *
 * Responsive: the inline link row shows from `md` up. On narrow screens it
 * would overflow the viewport, so below `md` it collapses to a hamburger that
 * toggles a stacked dropdown panel. The panel auto-closes on route change.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { GitHubIcon, TelegramIcon, XIcon } from "./icons";

const GITHUB_URL = "https://github.com/thesisAI1/thesis";
const X_URL = "https://x.com/thesisonbase";
const TELEGRAM_URL = "https://t.me/thesistoken";

/** A nav entry. `match` is the route prefix that marks it active; hash-only
 *  jump links (e.g. $THESIS) omit it and never highlight. */
interface NavLink {
  label: string;
  href: string;
  match?: string;
}

/** The single, canonical nav. Order: Home · The Archive · Leaderboard · Pitch ·
 *  Docs · $THESIS. */
const NAV: NavLink[] = [
  { label: "Home", href: "/", match: "/" },
  { label: "The Archive", href: "/dashboard", match: "/dashboard" },
  { label: "Leaderboard", href: "/leaderboard", match: "/leaderboard" },
  { label: "Pitch", href: "/pitch", match: "/pitch" },
  { label: "Docs", href: "/docs", match: "/docs" },
  { label: "$THESIS", href: "/#token" },
];

const CTA = { label: "Submit a thesis", href: "/pitch" } as const;

/** Active when the route equals the link's `match` (exact for "/", prefix else). */
function isActive(pathname: string, match?: string): boolean {
  if (!match) return false;
  if (match === "/") return pathname === "/";
  return pathname === match || pathname.startsWith(`${match}/`);
}

export function TopBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile menu whenever the route changes — a tapped link navigates
  // and the panel should not linger over the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-[60] border-b border-border bg-[#0a0d14] shadow-[0_6px_24px_-18px_rgba(0,0,0,0.9)]">
      <div className="mx-auto flex max-w-shell items-center gap-5 px-5 py-[13px] sm:px-7">
        <Link href="/" className="flex items-center gap-[11px]" aria-label="THESIS — home">
          <span className="grid h-[34px] w-[34px] place-items-center rounded-md border border-border-2 bg-[linear-gradient(160deg,#1d2433,#11151f)] font-serif text-[20px] font-bold text-accent shadow-mark">
            Θ
          </span>
          <span className="t-wordmark text-[17px]">THESIS</span>
        </Link>

        {/* Desktop nav — inline from md up. */}
        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active = isActive(pathname, item.match);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-sm border border-transparent px-[13px] py-[7px] text-[13.5px] transition-colors hover:bg-panel hover:text-text ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                {item.label}
              </Link>
            );
          })}

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="GitHub"
            aria-label="GitHub"
            className="inline-flex items-center justify-center px-[9px] py-[7px] text-muted transition-colors hover:text-text"
          >
            <GitHubIcon width={16} height={16} />
          </a>
          <a
            href={X_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="@thesisonbase"
            aria-label="X"
            className="inline-flex items-center justify-center px-[9px] py-[7px] text-muted transition-colors hover:text-text"
          >
            <XIcon width={14} height={14} />
          </a>
          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Telegram"
            aria-label="Telegram"
            className="inline-flex items-center justify-center px-[9px] py-[7px] text-muted transition-colors hover:text-text"
          >
            <TelegramIcon width={16} height={16} />
          </a>

          <Link
            href={CTA.href}
            className="ml-[6px] rounded-md bg-[linear-gradient(160deg,#f0b455,#e09a2e)] px-[13px] py-[7px] text-[13.5px] font-semibold text-[#1a1305] shadow-primary"
          >
            {CTA.label}
          </Link>
        </nav>

        {/* Mobile hamburger — only below md. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="ml-auto inline-flex h-[38px] w-[38px] items-center justify-center rounded-md border border-border-2 text-muted transition-colors hover:text-text md:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {open ? (
              <path d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path d="M3 6h18M3 12h18M3 18h18" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile dropdown panel — stacked links, only below md and when open. */}
      {open && (
        <nav className="flex flex-col gap-0.5 border-t border-border px-5 pb-4 pt-2 md:hidden">
          {NAV.map((item) => {
            const active = isActive(pathname, item.match);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-sm px-3 py-[11px] text-[15px] transition-colors hover:bg-panel hover:text-text ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                {item.label}
              </Link>
            );
          })}

          <Link
            href={CTA.href}
            className="mt-2 rounded-md bg-[linear-gradient(160deg,#f0b455,#e09a2e)] px-3 py-[11px] text-center text-[15px] font-semibold text-[#1a1305] shadow-primary"
          >
            {CTA.label}
          </Link>

          <div className="mt-3 flex items-center gap-4 px-3">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub" className="inline-flex items-center gap-2 text-[13px] text-muted transition-colors hover:text-text">
              <GitHubIcon width={16} height={16} /> GitHub
            </a>
            <a href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="X" className="inline-flex items-center gap-2 text-[13px] text-muted transition-colors hover:text-text">
              <XIcon width={14} height={14} /> @thesisonbase
            </a>
            <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" aria-label="Telegram" className="inline-flex items-center gap-2 text-[13px] text-muted transition-colors hover:text-text">
              <TelegramIcon width={16} height={16} /> Telegram
            </a>
          </div>
        </nav>
      )}
    </header>
  );
}
