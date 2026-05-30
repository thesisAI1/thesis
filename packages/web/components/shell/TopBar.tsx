/**
 * Sticky Direction-B top nav (design `.bar`).
 *
 * The ΘTHESIS wordmark (a serif theta in a brushed chip + the spaced wordmark),
 * a set of nav links, the GitHub + X icon links and a trailing primary CTA. The
 * `site` and `dashboard` variants ship the two different link sets from the
 * redesign; pass `items` / `cta` to override.
 */
import Link from "next/link";
import { GitHubIcon, XIcon } from "./icons";

const GITHUB_URL = "https://github.com/thesisAI1/thesis";
const X_URL = "https://x.com/thesisonbase";

/** A single nav entry. `tone` styles the link; `external` opens in a new tab. */
export interface NavItem {
  label: string;
  href: string;
  tone?: "default" | "active" | "home";
  external?: boolean;
}

/** Trailing call-to-action button. */
export interface NavCta {
  label: string;
  href: string;
}

export type TopBarVariant = "site" | "dashboard";

export interface TopBarProps {
  variant?: TopBarVariant;
  /** Override the link set (defaults derive from `variant`). */
  items?: NavItem[];
  /** Override the primary CTA. `null` hides it (e.g. the dashboard). */
  cta?: NavCta | null;
}

/** Direction-B site nav: Pipeline · Faculty · Record · Dashboard ↗ · Docs · $THESIS. */
const SITE_ITEMS: NavItem[] = [
  { label: "Pipeline", href: "/#pipeline" },
  { label: "Faculty", href: "/#faculty" },
  { label: "Record", href: "/#record" },
  { label: "Dashboard ↗", href: "/dashboard" },
  { label: "Docs", href: "/docs" },
  { label: "$THESIS", href: "/#token" },
];

/** Dashboard nav: ↩ Home · Overview · Positions · Decisions · Leaderboard · $THESIS. */
const DASHBOARD_ITEMS: NavItem[] = [
  { label: "↩ Home", href: "/", tone: "home" },
  { label: "Overview", href: "#overview", tone: "active" },
  { label: "Positions", href: "#positions" },
  { label: "Decisions", href: "#decisions" },
  { label: "Leaderboard", href: "#leaderboard" },
  { label: "$THESIS", href: "/#token" },
];

const SITE_CTA: NavCta = { label: "Submit a thesis", href: "/#submit" };

function defaultItems(variant: TopBarVariant): NavItem[] {
  return variant === "dashboard" ? DASHBOARD_ITEMS : SITE_ITEMS;
}

function linkClasses(tone: NavItem["tone"]): string {
  const base =
    "rounded-sm border border-transparent px-[13px] py-[7px] text-[13.5px] transition-colors hover:bg-panel hover:text-text";
  if (tone === "active") return `${base} text-accent`;
  if (tone === "home") return `${base} mr-[6px] text-dim`;
  return `${base} text-muted`;
}

export function TopBar({ variant = "site", items, cta }: TopBarProps) {
  const navItems = items ?? defaultItems(variant);
  const navCta = cta === undefined ? (variant === "site" ? SITE_CTA : null) : cta;

  return (
    <header className="sticky top-0 z-[60] border-b border-border bg-[rgba(10,13,20,0.78)] backdrop-blur-[14px]">
      <div className="mx-auto flex max-w-shell items-center gap-5 px-7 py-[13px]">
        <Link href="/" className="flex items-center gap-[11px]">
          <span className="grid h-[34px] w-[34px] place-items-center rounded-md border border-border-2 bg-[linear-gradient(160deg,#1d2433,#11151f)] font-serif text-[20px] font-bold text-accent shadow-mark">
            Θ
          </span>
          <span className="t-wordmark text-[17px]">THESIS</span>
        </Link>

        <nav className="ml-auto flex items-center gap-1">
          {navItems.map((item) =>
            item.external ? (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClasses(item.tone)}
              >
                {item.label}
              </a>
            ) : (
              <Link key={item.href} href={item.href} className={linkClasses(item.tone)}>
                {item.label}
              </Link>
            ),
          )}

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

          {navCta ? (
            <Link
              href={navCta.href}
              className="ml-[6px] rounded-md bg-[linear-gradient(160deg,#f0b455,#e09a2e)] px-[13px] py-[7px] text-[13.5px] font-semibold text-[#1a1305] shadow-primary"
            >
              {navCta.label}
            </Link>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
