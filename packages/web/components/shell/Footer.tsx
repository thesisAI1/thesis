/**
 * Site footer (design `footer` / `.foot-in`). A fine-print line on the left and
 * a row of mono links on the right (Docs · GitHub · @thesisonbase · DexScreener
 * · BaseScan). Internal links route via next/link; the rest open in a new tab.
 */
import Link from "next/link";

const THESIS_CA = "0x36e807119529E44d6F36aD5CE24AeB87a4529ba3";
const GITHUB_URL = "https://github.com/thesisAI1/thesis";
const X_URL = "https://x.com/thesisonbase";
const DEXSCREENER_URL = `https://dexscreener.com/base/${THESIS_CA}`;
const BASESCAN_URL = `https://basescan.org/token/${THESIS_CA}`;

interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

const LINKS: FooterLink[] = [
  { label: "Home", href: "/" },
  { label: "Pitch", href: "/pitch" },
  { label: "Docs", href: "/docs" },
  { label: "GitHub", href: GITHUB_URL, external: true },
  { label: "@thesisonbase", href: X_URL, external: true },
  { label: "DexScreener", href: DEXSCREENER_URL, external: true },
  { label: "BaseScan ↗", href: BASESCAN_URL, external: true },
];

export function Footer() {
  return (
    <footer className="mt-10 border-t border-border">
      <div className="mx-auto flex max-w-shell flex-wrap items-center justify-between gap-[14px] px-7 py-[26px]">
        <span className="font-mono text-[11px] tracking-[0.4px] text-dim">
          © MMXXVI · THESIS · runs on Base · every trade on-chain · not financial advice
        </span>
        <nav className="flex flex-wrap gap-[22px]">
          {LINKS.map((link) =>
            link.external ? (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[12px] text-muted transition-colors hover:text-accent"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className="font-mono text-[12px] text-muted transition-colors hover:text-accent"
              >
                {link.label}
              </Link>
            ),
          )}
        </nav>
      </div>
    </footer>
  );
}
