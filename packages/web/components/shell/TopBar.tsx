"use client";

/**
 * The site nav (design `.bar`) — one solid, consistent bar on every page.
 *
 * A fixed, opaque sticky header: the ΘTHESIS wordmark, a single route-based
 * link set (Home · The Archive · Leaderboard · Pitch · Docs · $THESIS), the GitHub + X icon
 * links and the amber "Submit a thesis" CTA. The active page is derived from
 * the current route via `usePathname`, so the same nav renders identically on
 * the home page, the live record, the pitch page and the docs — no per-page
 * variants. (Replaces the earlier `variant`/`items`/`cta` system from when the
 * site was a single long scroll.)
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GitHubIcon, XIcon } from "./icons";

const GITHUB_URL = "https://github.com/thesisAI1/thesis";
const X_URL = "https://x.com/thesisonbase";

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

  return (
    <header className="sticky top-0 z-[60] border-b border-border bg-[#0a0d14] shadow-[0_6px_24px_-18px_rgba(0,0,0,0.9)]">
      <div className="mx-auto flex max-w-shell items-center gap-5 px-7 py-[13px]">
        <Link href="/" className="flex items-center gap-[11px]" aria-label="THESIS — home">
          <span className="grid h-[34px] w-[34px] place-items-center rounded-md border border-border-2 bg-[linear-gradient(160deg,#1d2433,#11151f)] font-serif text-[20px] font-bold text-accent shadow-mark">
            Θ
          </span>
          <span className="t-wordmark text-[17px]">THESIS</span>
        </Link>

        <nav className="ml-auto flex items-center gap-1">
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

          <Link
            href={CTA.href}
            className="ml-[6px] rounded-md bg-[linear-gradient(160deg,#f0b455,#e09a2e)] px-[13px] py-[7px] text-[13.5px] font-semibold text-[#1a1305] shadow-primary"
          >
            {CTA.label}
          </Link>
        </nav>
      </div>
    </header>
  );
}
