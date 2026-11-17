// spec/frontend/views.md, "Recent Points sum each UTC day of the last days including today"; spec/points/profiles.md, "A missing issue history is recorded as a coverage gap, never as zero"
import { contributorPullSearchUrl, type ProfileIndex, profileCounts } from "@repo/points/client";
import { BarChart, cn, DataState, MetricGrid } from "@repo/ui";
import type { ReactNode } from "react";
import { type DatedAward, dailyPoints } from "../../projections/profile.ts";
import type { Shown } from "../home/listing.ts";
import { formatDate } from "../projects/index.ts";
import { ContributorIdentity } from "./ContributorIdentity.tsx";
import { activityDays, censusMatches } from "./profile.ts";

export type ProfileActivityProps = {
  /** The login asked for. */
  login: string;
  /** The contributor's actor id, once a record names it. */
  actorId?: string;
  /** The member's dated Points awards, newest first. */
  awards?: ReadonlyArray<DatedAward>;
  /** The profile census of recorded pull requests. */
  census: Shown<ProfileIndex>;
  /** Shows the identity header from the census record. */
  showIdentity: boolean;
  /** Status lines and links under the identity. */
  badges?: ReactNode;
  /** The Points totals. */
  summary?: ReactNode;
  /** Sections shown between the record and the payments. */
  children?: ReactNode;
  /** The awards and payments section. */
  payments?: ReactNode;
  /** Now, in milliseconds, whose UTC day ends the chart. */
  nowMs: number;
};

const segments = [
  { key: "merged", label: "Merged", query: "is:merged", tone: "bg-primary" },
  { key: "open", label: "Open", query: "is:open", tone: "bg-muted-foreground" },
  { key: "closed", label: "Closed without merging", query: "is:closed is:unmerged", tone: "bg-border" },
] as const;

type Counts = { readonly merged: number; readonly open: number; readonly closed: number };

function PullRequestBar({ counts, login }: { counts: Counts; login: string }) {
  const total = counts.merged + counts.open + counts.closed;
  const decided = counts.merged + counts.closed;
  return (
    <section aria-label="Pull requests" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold text-foreground">Pull requests</h2>
        <span className="text-sm text-muted-foreground">
          {total.toLocaleString("en-US")} total{decided > 0 ? ` · ${Math.round((counts.merged * 100) / decided)}% merged` : ""}
        </span>
      </div>
      {total > 0 ? (
        <div aria-hidden className="flex h-2 w-full overflow-hidden rounded-full">
          {segments.map((segment) => (counts[segment.key] > 0 ? <span key={segment.key} className={segment.tone} style={{ flexGrow: counts[segment.key] }} /> : null))}
        </div>
      ) : null}
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-2">
            <span aria-hidden className={cn("size-2 rounded-full", segment.tone)} />
            <a href={contributorPullSearchUrl(login, segment.query)} className="text-primary underline underline-offset-4 hover:decoration-2">
              <strong>{counts[segment.key].toLocaleString("en-US")}</strong> PRs {segment.label.toLowerCase()}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActivityChart({ awards, nowMs }: { awards: ReadonlyArray<DatedAward>; nowMs: number }) {
  const days = dailyPoints(awards, nowMs, activityDays);
  if (Math.max(...days.map((day) => day.points)) <= 0) return null;
  const total = days.reduce((sum, day) => sum + day.points, 0);
  return (
    <section aria-label="Daily activity" className="flex flex-col gap-2">
      <h2 className="text-sm text-muted-foreground">Daily activity · last {activityDays} days</h2>
      <BarChart
        label={`Points per day, last ${activityDays} days: ${total.toLocaleString("en-US")} points`}
        bars={days.map((day) => ({ label: `${formatDate(day.day)} · ${day.points.toLocaleString("en-US")} points`, value: Math.max(0, day.points) }))}
      />
    </section>
  );
}

/** A contributor's record: identity, Points, daily activity, pull requests and payments; missing counts read as unavailable, never as zero. */
export function ProfileActivity({ login, actorId, awards, census, showIdentity, badges, summary, children, payments, nowMs }: ProfileActivityProps) {
  const matches = census.value === undefined ? [] : censusMatches(census.value.people, login, actorId);
  const person = matches.length === 1 ? matches[0] : undefined;
  const id = actorId ?? person?.id;
  const counts: Counts | undefined = person ? profileCounts(person) : id && census.value !== undefined ? { merged: 0, open: 0, closed: 0 } : undefined;
  const shownLogin = person?.login ?? login;
  return (
    <section aria-label="Contributor profile" className="flex flex-col gap-8">
      {showIdentity ? (
        <ContributorIdentity
          actor={{
            login: shownLogin,
            avatarUrl: person?.avatarUrl ?? `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?size=160`,
            url: `https://github.com/${encodeURIComponent(shownLogin)}`,
          }}
        />
      ) : null}
      {badges}
      {summary ? <MetricGrid>{summary}</MetricGrid> : null}
      {awards ? <ActivityChart awards={awards} nowMs={nowMs} /> : null}
      <DataState status={census.status} onRetry={census.onRetry} retryLabel="Retry profile">
        {counts ? <PullRequestBar counts={counts} login={shownLogin} /> : null}
      </DataState>
      {children}
      {payments}
    </section>
  );
}
