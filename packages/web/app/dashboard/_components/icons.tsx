/**
 * Dashboard-local KPI glyphs (1.8px outline, currentColor) — ported verbatim
 * from the Direction-B dashboard mockup's bento cards. Shell-shared marks
 * (GitHub/X/copy) live in components/shell/icons.tsx; these are page decoration.
 */
import type { SVGProps } from "react";

function Outline(props: SVGProps<SVGSVGElement> & { children: React.ReactNode }) {
  const { children, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Wallet — portfolio value. */
export function WalletIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Outline {...props}>
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </Outline>
  );
}

/** Up-trend — realised PnL. */
export function TrendUpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Outline {...props}>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </Outline>
  );
}

/** Trophy — win rate. */
export function TrophyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Outline {...props}>
      <circle cx="12" cy="8" r="6" />
      <path d="M9 16l-1.5 6 4.5-3 4.5 3-1.5-6" />
    </Outline>
  );
}

/** Check — funded / approved. */
export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Outline {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Outline>
  );
}

/** Flame — buyback & burn. */
export function FlameIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Outline {...props}>
      <path d="M12 2c1 3-1 5-2 6-1.5 1.5-3 3-3 6a5 5 0 0 0 10 0c0-2-1-3.5-2-5 0 1.5-1 2.5-2 2.5 1-2.5-1-5.5-1-9.5Z" />
    </Outline>
  );
}

/** Search — filter input. */
export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
