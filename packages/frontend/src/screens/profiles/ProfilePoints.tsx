// spec/frontend/views.md, "Recent Points sum each UTC day of the last days including today"; spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"; spec/backend/xConnection.md, "The verified X ID is reserved forever to the first GitHub identity that links it"
import type { XProfile } from "@repo/backend/client";
import type { ProfileIndex } from "@repo/points/client";
import { DataState, Metric, NotFound } from "@repo/ui";
import type { ReactNode } from "react";
import { recentPoints } from "../../projections/profile.ts";
import type { Shown } from "../home/listing.ts";
import { XAccountLink } from "../points/People.tsx";
import { lifetimeTotals, type StandingHistory } from "../points/standings.ts";
import { ProfileActivity } from "./ProfileActivity.tsx";
import { censusMatches, type MembershipFacts, recentDays } from "./profile.ts";

export type JoinStatus = "loading" | "unavailable" | "absent" | "ready";

export type ProfilePointsProps = {
  /** The login asked for. */
  login: string;
  /** The contributor's actor id, once a record names it. */
  actorId?: string;
  /** The profile census. */
  census: Shown<ProfileIndex>;
  /** The Points journal as standings. */
  history: Shown<StandingHistory>;
  /** The signed-in member, when this is their own profile. */
  own: MembershipFacts | undefined;
  /** The public membership looked up by login. */
  joined: MembershipFacts | undefined;
  /** Where the membership lookup is. */
  joinStatus: JoinStatus;
  /** The member's connected X profile, read once an actor is known. */
  x?: Shown<XProfile | null>;
  /** Shows the identity header from the census record. */
  showIdentity?: boolean;
  /** No score record names the login, so no Points record either means no contributor. */
  notFoundWhenUnrecorded?: boolean;
  /** Sections shown between the record and the payments. */
  children?: ReactNode;
  /** The awards and payments section. */
  payments?: ReactNode;
  /** Now, in milliseconds. */
  nowMs: number;
};

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

function XBadge({ x }: { x: Shown<XProfile | null> | undefined }) {
  if (x?.value) return <XAccountLink account={x.value} />;
  if (x && (x.status === "Failed" || x.status === "Invalid" || x.status === "Unavailable" || x.status === "Denied")) return <small className="text-sm text-muted-foreground">X unavailable</small>;
  return null;
}

/** A contributor's Points: the last 30 days and the total with participation, the daily chart, pull requests and payments; a contributor no source records is not found. */
export function ProfilePoints({ login, actorId, census, history, own, joined, joinStatus, x, showIdentity = false, notFoundWhenUnrecorded = false, children, payments, nowMs }: ProfilePointsProps) {
  const wanted = login.toLowerCase();
  const ready = history.value !== undefined;
  const members = history.value?.members ?? [];
  const named = members.filter((member) => member.actor.login.toLowerCase() === wanted);
  const matches = census.value === undefined ? [] : censusMatches(census.value.people, login, actorId);
  const recorded = matches.length === 1 ? matches[0] : undefined;
  const membership = own ?? (joined?.actor.login.toLowerCase() === wanted ? joined : undefined);
  const identity = !actorId || membership?.actor.id === actorId ? membership : undefined;
  const resolved = actorId ?? identity?.actor.id ?? recorded?.id;
  const member = resolved ? members.find((entry) => entry.actor.id === resolved) : named.length === 1 ? named[0] : undefined;
  const known = ready && (member !== undefined || identity !== undefined || recorded !== undefined || (actorId !== undefined && joinStatus === "absent"));
  const unavailable = known ? undefined : history.status === "Loading" || history.status === "Idle" ? "Loading…" : "Unavailable";
  if (notFoundWhenUnrecorded && ready && census.value !== undefined && joinStatus === "absent" && !own && !member && !recorded && named.length === 0) {
    return <NotFound as="section" title="Contributor not found" />;
  }
  const total = (member && history.value ? (lifetimeTotals(history.value).get(member.actor.id) ?? 0) : 0) + (identity?.welcome ?? 0) + (identity?.socialPoints ?? 0);
  return (
    <section aria-label="Slop Points" className="flex flex-col gap-6">
      <ProfileActivity
        login={login}
        actorId={resolved}
        awards={member?.awards}
        census={census}
        showIdentity={showIdentity}
        nowMs={nowMs}
        badges={
          <>
            <DataState status={history.status} onRetry={history.onRetry} retryLabel="Retry points" />
            {ready && (member || identity || recorded) ? (
              <div className="flex flex-wrap gap-4">
                <XBadge x={x} />
              </div>
            ) : ready && (joinStatus === "loading" || joinStatus === "unavailable") ? (
              <p>{joinStatus === "loading" ? "Looking up membership…" : "Membership could not load."}</p>
            ) : null}
          </>
        }
        summary={
          <>
            <Metric label={`${recentDays} days`} value={unavailable ?? recentPoints(member?.awards ?? [], nowMs, recentDays).toLocaleString("en-US")} />
            <Metric label="Total" value={unavailable ?? total.toLocaleString("en-US")} />
          </>
        }
        payments={payments}
      >
        {own ? (
          <a href="/inbox?points" className={linkClass}>
            Review Points history
          </a>
        ) : null}
        {children}
      </ProfileActivity>
    </section>
  );
}
