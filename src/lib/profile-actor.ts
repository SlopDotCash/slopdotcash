import type { ActorRef, GitHubActor } from "./leaderboard-types";
import type { DataState } from "./use-snapshot";

/**
 * The profile directory as the profile page reads it: ready with its people,
 * or not yet read.
 */
export type ProfileActorDirectory =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; index: { people: ActorRef[] } };

/** The membership slice the profile page reads for one profile URL. */
export type ProfileActorMembership = {
  own: { actor: ActorRef } | null;
  signedInActor?: ActorRef;
  sessionStatus: "loading" | "ready" | "error";
  joined: { actor: ActorRef } | null;
  joinStatus: "loading" | "unavailable" | "absent" | "ready";
};

/**
 * Resolve the actor a /contributors/<login> page stands for, or undefined
 * when no identity source confirms that login for one actor.
 */
export function currentProfileActor(
  state: DataState,
  login: string,
  profiles: ProfileActorDirectory,
  membership: ProfileActorMembership,
): GitHubActor | undefined {
  if (state.status !== "ready") return;
  const normalizedLogin = login.toLowerCase();
  const matchesLogin = (actor: { login: string }) =>
    actor.login.toLowerCase() === normalizedLogin;
  const asActor = (actor: {
    id: string;
    login: string;
    avatarUrl?: string;
  }): GitHubActor => ({
    id: actor.id,
    login: actor.login,
    avatarUrl:
      actor.avatarUrl ??
      `https://avatars.githubusercontent.com/${encodeURIComponent(actor.login)}?size=160`,
    url: `https://github.com/${encodeURIComponent(actor.login)}`,
    kind: "User",
  });
  const actors: Array<{ id: string; login: string; avatarUrl?: string }> = [
    ...(membership.signedInActor ? [membership.signedInActor] : []),
    ...state.snapshot.leaders.map((leader) => leader.actor),
    ...(state.snapshot.reviewExclusions ?? []).flatMap((exclusion) =>
      exclusion.reviewer?.kind === "User" ? [exclusion.reviewer] : [],
    ),
    ...state.views.flatMap((view) => [
      ...view.leaders.map((leader) => leader.actor),
      ...view.opportunities.map((opportunity) => opportunity.actor),
    ]),
  ];
  // The membership row keeps the login captured at the last sign-in, while the
  // published snapshot carries the journal's current record per actor id. When
  // the two disagree for the same id, the signed-in login is stale and must
  // not veto the journal's current record for that id. The login-collision
  // side (same login, different id) still vetoes.
  const signedInActor = membership.signedInActor;
  const signedInIsStale =
    signedInActor !== undefined &&
    state.snapshot.leaders.some(
      (leader) =>
        leader.actor.id === signedInActor.id &&
        leader.actor.login.toLowerCase() !== signedInActor.login.toLowerCase(),
    );
  const conflictsWith = (candidate: { id: string }) =>
    actors.some((actor) => {
      if (actor.id !== candidate.id) return matchesLogin(actor);
      if (signedInIsStale && actor === signedInActor) return false;
      return !matchesLogin(actor);
    });
  // Every identity source can veto a stale login. Wait for the session,
  // membership and directory before selecting the actor for wallet/history reads.
  if (
    profiles.status !== "ready" ||
    membership.sessionStatus === "loading" ||
    (!membership.own && membership.joinStatus === "loading")
  )
    return;
  const directoryConflict = (candidate: { id: string }) =>
    profiles.index.people.some((person) =>
      person.id === candidate.id ? !matchesLogin(person) : matchesLogin(person),
    );
  const member = membership.own ?? membership.joined;
  if (member)
    return matchesLogin(member.actor) &&
      !conflictsWith(member.actor) &&
      !directoryConflict(member.actor)
      ? asActor(member.actor)
      : undefined;
  const current = actors.find(matchesLogin);
  if (current) {
    if (conflictsWith(current) || directoryConflict(current)) return;
    return asActor(current);
  }
  // The directory can resolve an inactive actor, but cannot override a known rename.
  const candidates = profiles.index.people.filter(
    (person) =>
      matchesLogin(person) &&
      !actors.some((actor) => actor.id === person.id && !matchesLogin(actor)),
  );
  if (candidates.length !== 1) return;
  return asActor(candidates[0]);
}
