// spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"
import { DataState, Leaderboard, Spinner } from "@repo/ui";
import type { Shown } from "./listing.ts";
import { type LifetimeTotal, topStandings } from "./standings.ts";

export type HomeStandingsProps = {
  /** All-time Points totals of every contributor with Points. */
  totals: Shown<ReadonlyArray<LifetimeTotal>>;
};

/** The top contributors by all-time Points, equal totals sharing a rank. */
export function HomeStandings({ totals }: HomeStandingsProps) {
  const rows = topStandings(totals.value ?? []);
  return (
    <section id="leaderboard" aria-labelledby="home-standings-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 id="home-standings-title" className="text-2xl font-semibold text-foreground">
          Top sloperators
        </h2>
        <a href="/points?period=lifetime" className="text-primary underline underline-offset-4 hover:decoration-2">
          View leaderboard
        </a>
      </div>
      <DataState status={totals.status} onRetry={totals.onRetry} skeleton={<Spinner label="Loading top contributors" />}>
        {rows.length === 0 ? <p className="text-muted-foreground">No contributors yet.</p> : <Leaderboard label="Contributor standings table" rows={rows} />}
      </DataState>
    </section>
  );
}
