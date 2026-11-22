// spec/frontend/views.md, "Story: Read a contributor's profile"; spec/frontend/views.md, "A profile login resolves through membership, current actors, directory and journal in that order, and any current source vetoes a stale login"; spec/backend/xConnection.md, "The verified X ID is reserved forever to the first GitHub identity that links it"
import type { XProfile } from "@repo/backend/client";
import type { ProfileIndex } from "@repo/points/client";
import { DataState, NotFound } from "@repo/ui";
import type { ReactNode } from "react";
import type { Shown } from "../home/listing.ts";
import { XAccountLink } from "../points/People.tsx";
import type { StandingHistory } from "../points/standings.ts";
import { ProfileActivity } from "./ProfileActivity.tsx";
import { censusMatches, type MembershipFacts } from "./profile.ts";

export type JoinStatus = "loading" | "unavailable" | "absent" | "ready";

export type ProfilePointsProps = {
  /** The login asked for. */
  login: string;
  /** The contributor's actor id, once a record names it. */
  actorId?: string;
  /** The profile census. */
  census: Shown<ProfileIndex>;
  /** The Points journal, whose members confirm a login. */
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
};

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

function XBadge({ x }: { x: Shown<XProfile | null> | undefined }) {
  if (x?.value) return <XAccountLink account={x.value} />;
  if (x && (x.status === "Failed" || x.status === "Invalid" || x.status === "Unavailable" || x.status === "Denied")) return <small className="text-sm text-muted-foreground">X unavailable</small>;
  return null;
}

/** A contributor's record without Points figures: identity, X account, pull requests and payments; a contributor no source records is not found. */
export function ProfilePoints({ login, actorId, census, history, own, joined, joinStatus, x, showIdentity = false, notFoundWhenUnrecorded = false, children, payments }: ProfilePointsProps) {
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
  if (notFoundWhenUnrecorded && ready && census.value !== undefined && joinStatus === "absent" && !own && !member && !recorded && named.length === 0) {
    return <NotFound as="section" title="Contributor not found" />;
  }
  return (
    <section aria-label="Slop Points" className="flex flex-col gap-6">
      <ProfileActivity
        login={login}
        actorId={resolved ?? member?.actor.id}
        census={census}
        showIdentity={showIdentity}
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
