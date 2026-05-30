/**
 * The Record (design `#record` / `.stats`) — live committee performance, read
 * from the wallet via getDashboard(). Four tiles: portfolio value, realised
 * PnL, win rate, reviewed count. Falls back to a zero state when the dashboard
 * payload is unavailable (the page passes `data = null` on a backend error).
 */
import { Reveal } from "./Reveal";
import { CountUp } from "./CountUp";
import { SectionHead } from "./SectionHead";
import type { DashboardData } from "@/lib/api";

export interface RecordProps {
  data: DashboardData | null;
}

interface StatTile {
  value: React.ReactNode;
  label: string;
  note: string;
  hero?: boolean;
  valueColor?: string;
}

function buildTiles(data: DashboardData | null): StatTile[] {
  const p = data?.portfolio;
  const reviews = data?.reviews;

  const portfolioUsd = Math.round(p?.totalPortfolioValueUsd ?? 0);
  const realisedEth = p?.realizedPnlEth ?? 0;
  const winPct = Math.round((p?.winRate ?? 0) * 100);
  const closed = p?.closedCount ?? 0;
  const wins = p?.winCount ?? 0;
  const reviewed = reviews?.total ?? 0;
  const buys = reviews?.buys ?? 0;
  const realisedPositive = realisedEth >= 0;

  return [
    {
      hero: true,
      value: <CountUp value={portfolioUsd} prefix="$" group />,
      label: "Portfolio value",
      note: "wallet + open positions",
    },
    {
      value: (
        <>
          <CountUp value={realisedEth} decimals={2} prefix={realisedPositive ? "+" : ""} /> Ξ
        </>
      ),
      valueColor: realisedPositive ? "var(--green)" : "var(--red)",
      label: "Realised PnL",
      note: "since inception",
    },
    {
      value: <CountUp value={winPct} suffix="%" />,
      label: "Win rate",
      note: `${wins} / ${closed} closed`,
    },
    {
      value: <CountUp value={reviewed} group />,
      label: "Reviewed",
      note: `${buys} funded`,
    },
  ];
}

export function Record({ data }: RecordProps) {
  const tiles = buildTiles(data);

  return (
    <section id="record" className="py-[30px]">
      <div className="mx-auto max-w-shell px-7">
        <SectionHead index="02" title="The Record" meta="REFRESHED FROM THE WALLET · LIVE" />

        <div className="grid grid-cols-2 gap-[14px] md:grid-cols-[1.35fr_1fr_1fr_1fr]">
          {tiles.map((tile, i) => (
            <Reveal
              key={tile.label}
              delay={i * 90}
              className={tile.hero ? "max-md:col-span-2" : undefined}
            >
              <div
                className={`relative h-full overflow-hidden rounded-lg border px-6 pb-[22px] pt-6 before:absolute before:inset-x-0 before:top-0 before:h-px before:content-[''] ${
                  tile.hero
                    ? "border-border-2 bg-[linear-gradient(180deg,#1a2030_0%,var(--panel)_100%)] before:bg-[linear-gradient(90deg,transparent,rgba(230,163,62,0.4),transparent)]"
                    : "border-border bg-[linear-gradient(180deg,#131825_0%,#0e1219_100%)] before:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent)]"
                }`}
              >
                <div
                  className="text-[clamp(30px,3.4vw,44px)] font-extrabold leading-none tracking-[-1.5px] tabular-nums"
                  style={tile.valueColor ? { color: tile.valueColor } : undefined}
                >
                  {tile.value}
                </div>
                <div className="mt-[14px] font-mono text-[10.5px] uppercase tracking-[1.4px] text-muted">
                  {tile.label}
                </div>
                <div className="mt-[5px] font-mono text-[11px] text-dim">{tile.note}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
