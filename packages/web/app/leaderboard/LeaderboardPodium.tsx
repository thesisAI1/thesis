"use client";

/**
 * The top-3 podium — a faithful port of the original site's `#podium`: silver
 * (2nd) on the left, gold (1st) raised and wider in the centre, bronze (3rd) on
 * the right. Each card floats a pill rank badge on its top edge. Shared by the
 * /leaderboard page and the homepage Top Authors section. Needs ≥3 authors.
 */
import { useState } from "react";
import type { LeaderboardEntry } from "@/lib/api";

interface Medal {
  cls: "gold" | "silver" | "bronze";
  label: string;
  slot: number; // index into entries (0 = 1st place)
  border: string;
  badge: string;
  numColor: string;
  avatar: number;
  pad: string;
  raise: boolean;
  handleSize: number;
  earnedSize: number;
}

// Visual order, left → right: 2nd, 1st (centre), 3rd.
const PODIUM: Medal[] = [
  { cls: "silver", label: "2ND", slot: 1, border: "#2c323e", badge: "#9ca0aa", numColor: "var(--dim)", avatar: 56, pad: "22px 16px", raise: false, handleSize: 17, earnedSize: 21 },
  { cls: "gold", label: "1ST", slot: 0, border: "#4a3a18", badge: "#d4a23a", numColor: "#d4a23a", avatar: 64, pad: "28px 16px", raise: true, handleSize: 19, earnedSize: 23 },
  { cls: "bronze", label: "3RD", slot: 2, border: "#2a2218", badge: "#a06a3d", numColor: "var(--dim)", avatar: 56, pad: "22px 16px", raise: false, handleSize: 17, earnedSize: 21 },
];

function xProfile(handle: string): string {
  return `https://x.com/${encodeURIComponent(handle.replace(/^@/, ""))}`;
}
function fmtEth(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(4)}`;
}
function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function Avatar({ e, size }: { e: LeaderboardEntry; size: number }) {
  const [broken, setBroken] = useState(false);
  const init = e.authorHandle.replace(/^@/, "").slice(0, 2).toUpperCase();
  if (e.authorAvatarUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={e.authorAvatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="rounded-full object-cover"
        style={{ width: size, height: size, background: "var(--panel-2)" }}
      />
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-semibold text-muted"
      style={{ width: size, height: size, fontSize: 13, background: "var(--panel-2)" }}
    >
      {init}
    </span>
  );
}

export function LeaderboardPodium({ entries }: { entries: LeaderboardEntry[] }) {
  if (entries.length < 3) return null;

  return (
    <div className="mb-9 mt-8 grid grid-cols-1 items-stretch gap-3.5 sm:items-end sm:[grid-template-columns:1fr_1.12fr_1fr]">
      {PODIUM.map((m) => {
        const e = entries[m.slot];
        return (
          <div
            key={m.cls}
            className={`relative rounded-xl border bg-panel text-center ${
              m.raise ? "order-first sm:order-none sm:-translate-y-[10px]" : ""
            }`}
            style={{
              borderColor: m.border,
              padding: m.pad,
              boxShadow: m.raise ? `inset 0 0 0 1px ${m.border}` : undefined,
            }}
          >
            <span
              className="absolute left-1/2 -translate-x-1/2 rounded-full font-mono font-semibold"
              style={{ top: -10, fontSize: 10.5, letterSpacing: "1.2px", padding: "4px 11px", color: "#0e1218", background: m.badge }}
            >
              {m.label}
            </span>
            <div className="font-mono" style={{ fontSize: 11, marginBottom: 6, color: m.numColor }}>
              RANK {String(e.rank).padStart(2, "0")}
            </div>
            <div className="flex justify-center" style={{ marginBottom: m.raise ? 14 : 12 }}>
              <Avatar e={e} size={m.avatar} />
            </div>
            <div
              className="truncate font-semibold"
              style={{ fontSize: m.handleSize, marginBottom: 14 }}
              title={e.authorHandle}
            >
              <a
                href={xProfile(e.authorHandle)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-text hover:underline"
              >
                {e.authorHandle}
              </a>
            </div>
            <div className="font-mono" style={{ fontSize: m.earnedSize, marginBottom: 4, color: "var(--green)" }}>
              {fmtEth(e.totalEarnedEth)} ETH
            </div>
            {e.totalEarnedSol > 0 && (
              <div className="font-mono" style={{ fontSize: m.earnedSize - 4, marginBottom: 4, color: "#9945FF" }}>
                {fmtEth(e.totalEarnedSol)} SOL
              </div>
            )}
            {e.totalEarnedUsd > 0 && (
              <div className="font-mono text-dim" style={{ fontSize: 12, marginBottom: 4 }}>
                ≈ {fmtUsd(e.totalEarnedUsd)}
              </div>
            )}
            <div className="text-dim" style={{ fontSize: 12 }}>
              {e.funded} funded · {e.wins} {e.wins === 1 ? "win" : "wins"}
              {e.closed > 0 ? ` · ${Math.round(e.winRate * 100)}% win rate` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}
