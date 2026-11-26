// spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"; spec/ui/pagination.md, "The page stays within the pages that exist"; spec/frontend/requests.md, "Only the current request may publish its validated result"
import { cn, DataState, Leaderboard, type LeaderboardRow, Pagination, sectionTitle } from "@repo/ui";
import type { Shown } from "../home/listing.ts";
import { pageRows, usePages } from "./pages.ts";
import { matching, type Period, type StandingHistory, type StandingRow, standingRows } from "./standings.ts";

export type ContributorStandingsProps = {
  /** The Points journal as standings, from its read. */
  history: Shown<StandingHistory>;
  /** This month's standings or all of history. */
  period: Period;
  /** Part of a login; only matching contributors are listed, keeping their ranks. */
  query: string;
  /** The 1-based page asked for by the address. */
  page: number;
  /** Hears the page moved to. */
  onPage?: (page: number) => void;
  /** The short table of a project page: ten rows, a heading and points marked "pts". */
  compact?: boolean;
  /** The section's name. */
  title?: string;
  /** Where the full leaderboard is, shown beside a compact heading. */
  fullView?: string;
  /** Now, in milliseconds, which decides this month. */
  nowMs: number;
};

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

/** @throws {URIError} */
function leaderboardRow(row: StandingRow, compact: boolean): LeaderboardRow {
  const login = encodeURIComponent(row.actor.login);
  return {
    rank: row.rank,
    actor: { login: row.actor.login, href: `/contributors/${login}`, avatarUrl: `https://avatars.githubusercontent.com/${login}?size=80` },
    points: `${row.points.toLocaleString("en-US")}${compact ? " pts" : ""}`,
  };
}

function Rows({ history, period, query, page, onPage, compact, nowMs }: Required<Pick<ContributorStandingsProps, "period" | "query" | "page" | "compact" | "nowMs">> & Pick<ContributorStandingsProps, "onPage"> & { history: StandingHistory | undefined }) {
  const size = compact ? 10 : 25;
  const rows = history === undefined ? [] : matching(standingRows(history, period, nowMs), query, (row) => row.actor.login);
  const [pages, send] = usePages(page, history === undefined ? undefined : rows.length, size, onPage);
  return (
    <>
      <Leaderboard label="Contributor standings table" rows={pageRows(rows, pages, size).map((row) => leaderboardRow(row, compact))} />
      {rows.length === 0 ? <p className="text-muted-foreground">No results</p> : null}
      <Pagination state={pages} onSend={send} label="Contributor standings pages" />
    </>
  );
}

/** Contributors ranked by the Points of the period, equal totals sharing a rank; the read's loading, failure and staleness are shown, never an empty board. */
export function ContributorStandings({ history, period, query, page, onPage, compact = false, title = "Contributor standings", fullView, nowMs }: ContributorStandingsProps) {
  return (
    <section aria-label={title} className={cn("flex flex-col gap-4", compact && "gap-6 rounded-xl border border-border p-8 max-md:p-5")}>
      {compact ? (
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className={sectionTitle}>{title}</h2>
          {fullView ? (
            <a href={fullView} className={linkClass}>
              View leaderboard
            </a>
          ) : null}
        </div>
      ) : null}
      <DataState status={history.status} onRetry={history.onRetry} retryLabel="Retry points">
        <Rows key={`${period}\n${query}`} history={history.value} period={period} query={query} page={page} onPage={onPage} compact={compact} nowMs={nowMs} />
      </DataState>
    </section>
  );
}
