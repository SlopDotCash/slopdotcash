// spec/frontend/views.md, "Story: Read a contributor's profile"; spec/points/profiles.md, "A missing issue history is recorded as a coverage gap, never as zero"
import { contributorPullSearchUrl, type ProfileIndex, profileCounts } from "@repo/points/client";
import { cn, DataState } from "@repo/ui";
import type { ReactNode } from "react";
import type { Shown } from "../home/listing.ts";
import { ContributorIdentity } from "./ContributorIdentity.tsx";
import { censusMatches } from "./profile.ts";

export type ProfileActivityProps = {
  /** The login asked for. */
  login: string;
  /** The contributor's actor id, once a record names it. */
  actorId?: string;
  /** The profile census of recorded pull requests. */
  census: Shown<ProfileIndex>;
  /** Shows the identity header from the census record. */
  showIdentity: boolean;
  /** Status lines and links under the identity. */
  badges?: ReactNode;
  /** Sections shown between the record and the payments. */
  children?: ReactNode;
  /** The awards and payments section. */
  payments?: ReactNode;
};

export const profileCard = "flex flex-col rounded-xl border border-border bg-card p-5.5";
export const profileCardHeading = "flex flex-wrap items-baseline justify-between gap-2 [&>span]:text-ui [&>span]:font-bold [&>span]:text-muted-foreground";
export const profileCardTitle = "text-name leading-tight font-extrabold tracking-tight text-foreground uppercase";

const segments = [
  { key: "merged", label: "Merged", query: "is:merged", tone: "bg-ok" },
  { key: "open", label: "Open", query: "is:open", tone: "bg-warn" },
  { key: "closed", label: "Closed", query: "is:closed is:unmerged", tone: "bg-muted-foreground" },
] as const;

type Counts = { readonly merged: number; readonly open: number; readonly closed: number };

function PullRequestBar({ counts, login }: { counts: Counts; login: string }) {
  const total = counts.merged + counts.open + counts.closed;
  const decided = counts.merged + counts.closed;
  return (
    <section aria-label="Pull requests" className={profileCard}>
      <div className={profileCardHeading}>
        <h2 className={profileCardTitle}>Pull requests</h2>
        {decided > 0 ? <span className="text-sm text-muted-foreground">{Math.round((counts.merged * 100) / decided)}% merged</span> : null}
      </div>
      {total > 0 ? (
        <div aria-hidden className="mt-4 flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
          {segments.map((segment) => (counts[segment.key] > 0 ? <span key={segment.key} className={segment.tone} style={{ flexGrow: counts[segment.key] }} /> : null))}
        </div>
      ) : null}
      <ul className="mt-3.5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-2">
            <span aria-hidden className={cn("size-2 rounded-full", segment.tone)} />
            <a href={contributorPullSearchUrl(login, segment.query)} className="rounded-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
              <strong className="font-mono font-bold text-foreground">{counts[segment.key].toLocaleString("en-US")}</strong> {segment.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A contributor's record: identity, pull requests and payments; missing counts read as unavailable, never as zero. */
export function ProfileActivity({ login, actorId, census, showIdentity, badges, children, payments }: ProfileActivityProps) {
  const matches = census.value === undefined ? [] : censusMatches(census.value.people, login, actorId);
  const person = matches.length === 1 ? matches[0] : undefined;
  const id = actorId ?? person?.id;
  const counts: Counts | undefined = person ? profileCounts(person) : id && census.value !== undefined ? { merged: 0, open: 0, closed: 0 } : undefined;
  const shownLogin = person?.login ?? login;
  return (
    <section aria-label="Contributor profile" className="flex flex-col gap-5">
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
      <DataState status={census.status} onRetry={census.onRetry} retryLabel="Retry profile">
        {counts ? <PullRequestBar counts={counts} login={shownLogin} /> : null}
      </DataState>
      {children}
      {payments}
    </section>
  );
}
