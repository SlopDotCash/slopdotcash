import type { GitHubActor } from "./leaderboard";

export interface ProfileActorSource {
  id: string;
  login: string;
  avatarUrl?: string;
}

/**
 * Resolve the actor a contributor profile URL names, or undefined when no
 * settled source records that login.
 *
 * Source order is the profile page's doctrine: the login's own membership
 * record first, then the current identity sources (signed-in actor,
 * snapshot leaders, review-exclusion reviewers, project-view leaders and
 * opportunities), then the public directory. Every source can veto a stale
 * login: a candidate loses when another source or the directory holds the
 * same actor ID under a different login, or the same login under a
 * different actor ID.
 *
 * The Points journal is the last resort. It is the only public record that
 * still names earners the current snapshot and directory no longer carry
 * (review-only contributors, contributors whose repositories stopped being
 * collected), and the standings link to their profiles by the journal's
 * recorded login. A journal actor is not itself a source for vetoes — its
 * login can be stale — but the current sources and the directory veto it
 * exactly like any other candidate, so a recorded login that a rename has
 * superseded still resolves to no one. `journal` is null while the journal
 * has not loaded; the fallback then simply does not run.
 */
export function resolveProfileActor(args: {
  login: string;
  actors: readonly ProfileActorSource[];
  people: readonly { id: string; login: string }[];
  member: ProfileActorSource | null;
  journal: readonly ProfileActorSource[] | null;
}): GitHubActor | undefined {
  const { login, actors, people, member, journal } = args;
  const normalizedLogin = login.toLowerCase();
  const matchesLogin = (actor: { login: string }) =>
    actor.login.toLowerCase() === normalizedLogin;
  const asActor = (actor: ProfileActorSource): GitHubActor => ({
    id: actor.id,
    login: actor.login,
    avatarUrl:
      actor.avatarUrl ??
      `https://avatars.githubusercontent.com/${encodeURIComponent(actor.login)}?size=160`,
    url: `https://github.com/${encodeURIComponent(actor.login)}`,
    kind: "User",
  });
  const conflictsWith = (candidate: { id: string }) =>
    actors.some((actor) =>
      actor.id === candidate.id ? !matchesLogin(actor) : matchesLogin(actor),
    );
  const directoryConflict = (candidate: { id: string }) =>
    people.some((person) =>
      person.id === candidate.id ? !matchesLogin(person) : matchesLogin(person),
    );
  if (member)
    return matchesLogin(member) &&
      !conflictsWith(member) &&
      !directoryConflict(member)
      ? asActor(member)
      : undefined;
  const current = actors.find(matchesLogin);
  if (current) {
    if (conflictsWith(current) || directoryConflict(current)) return;
    return asActor(current);
  }
  // The directory can resolve an inactive actor, but cannot override a known rename.
  const candidates = people.filter(
    (person) =>
      matchesLogin(person) &&
      !actors.some((actor) => actor.id === person.id && !matchesLogin(actor)),
  );
  if (candidates.length === 1) return asActor(candidates[0]);
  if (candidates.length > 1) return;
  // The journal can resolve an earner no current source names, but cannot
  // override a conflict or a known rename.
  if (journal) {
    const recorded = journal.filter(matchesLogin);
    if (new Set(recorded.map((actor) => actor.id)).size === 1) {
      const candidate = recorded[0];
      if (!conflictsWith(candidate) && !directoryConflict(candidate))
        return asActor(candidate);
    }
  }
  return;
}
