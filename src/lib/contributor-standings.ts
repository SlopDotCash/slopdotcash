/** One display projection for score, contribution points and finalized principal. */
import { createGlobalLeaders } from "./global-leaderboard";
import type { PointsMember } from "./points";
import { findProject } from "./projects.mjs";
import type { DataState } from "./use-snapshot";

export type StandingsSort = "score" | "points" | "money";
export function contributorStandings(
  state: DataState,
  members: readonly PointsMember[] | null,
  month: string | null,
  projectId: string,
) {
  const scoreAvailable =
    state.status === "ready" &&
    (!month ||
      (state.snapshot.window.from.slice(0, 7) <= month &&
        state.snapshot.window.to.slice(0, 7) >= month) ||
      state.cycleIndex.cycles.some(
        (c) => c.cycleId === month && (!projectId || c.projectId === projectId),
      ));
  const currentActors = new Map(
    (members ?? []).map((member) => [member.actor.id, member.actor]),
  );
  if (state.status === "ready") {
    for (const leader of state.snapshot.leaders) {
      currentActors.set(leader.actor.id, leader.actor);
    }
  }
  const rows = new Map<
    string,
    {
      actor: { id: string; login: string };
      score: number | null;
      points: number | null;
      money: bigint | null;
      firstContributionAt: string | null;
    }
  >();
  const row = (actor: { id: string; login: string }) => {
    let value = rows.get(actor.id);
    if (!value) {
      value = {
        actor: currentActors.get(actor.id) ?? actor,
        score: scoreAvailable ? 0 : null,
        points: members ? 0 : null,
        money: state.status === "ready" ? 0n : null,
        firstContributionAt: null,
      };
      rows.set(actor.id, value);
    }
    return value;
  };
  if (state.status === "ready") {
    const repositories = projectId
      ? new Set(findProject(projectId)?.repositories.map((r) => r.id))
      : null;
    const cycles = state.cycleIndex.cycles.filter(
      (c) => !projectId || c.projectId === projectId,
    );
    const scores = createGlobalLeaders(
      {
        ...state.snapshot,
        ledger: state.snapshot.ledger.filter(
          (e) =>
            (!repositories || repositories.has(e.repository)) &&
            (!month || e.occurredAt.startsWith(month)),
        ),
      },
      [],
      {
        ...state.cycleIndex,
        cycles: cycles.filter((c) => !month || c.cycleId === month),
      },
    );
    for (const score of scores) row(score.actor).score = score.score;
    // Payment occurrence follows finalized settlement time, not the work month.
    for (const cycle of cycles) {
      if (month && !cycle.settledAt?.startsWith(month)) continue;
      for (const contributor of cycle.contributors) {
        if (BigInt(contributor.paidMinor) > 0n) {
          const recipient = row(contributor.actor);
          recipient.money =
            (recipient.money ?? 0n) + BigInt(contributor.paidMinor);
        }
      }
    }
  }
  for (const member of members ?? []) {
    const value = row(member.actor);
    value.points = month ? member.monthly : member.total;
    value.firstContributionAt = member.firstContributionAt;
  }
  return { rows: [...rows.values()], scoreAvailable };
}
