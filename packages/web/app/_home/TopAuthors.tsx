/**
 * Top Authors — the homepage podium of the three best-earning authors, sitting
 * under The Record and linking through to the full /leaderboard. Reuses the same
 * <LeaderboardPodium> as the leaderboard page so the podium reads identically in
 * both places.
 */
import Link from "next/link";
import type { LeaderboardEntry } from "@/lib/api";
import { SectionHead } from "./SectionHead";
import { LeaderboardPodium } from "@/app/leaderboard/LeaderboardPodium";

export function TopAuthors({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <section id="top-authors" className="py-[30px]">
      <div className="mx-auto max-w-shell px-7">
        <SectionHead
          index="02"
          title="Top Authors"
          meta={
            <Link href="/leaderboard" className="text-accent transition-colors hover:text-text">
              Full leaderboard →
            </Link>
          }
        />

        {entries.length >= 3 ? (
          <LeaderboardPodium entries={entries} />
        ) : (
          <p className="text-[14px] text-muted">
            No authors funded yet — the podium fills as the committee funds winning theses.
          </p>
        )}
      </div>
    </section>
  );
}
